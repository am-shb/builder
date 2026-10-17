// Build loop: turns conversation hand-offs into consensus-document updates and
// prototype patches with Opus. One run in flight per session; hand-offs that arrive
// meanwhile merge into the next run, at most one run per 10 s unless a conflict was
// just resolved. Also promotes pending decisions after 30 s without objection. When the call ends,
// end() stops all of it, so the consensus and the handoff are final (spec §14).
// Logs ids, counts and durations only: never transcript text, prompts or model output.
import { readFileSync } from "node:fs";
import { withCostRecording } from "./cost.ts";
import { strictCompatible, toolJsonSchema } from "./tool-schema.ts";
import type { ModelPort, PortTool, RunToolsResult } from "./llm.ts";
import { applyConsensusOps, enforceGrounding, groundCredit, HandoffSchema, sanitizeModelBatch, UpdateConsensusInput } from "./handoff.ts";
import type { ConsensusUpdate, Handoff, Proposal } from "./handoff.ts";
import { patchBatchJsonSchema, ToolPatchBatch } from "../ui/schema.ts";
import type { PatchBatch, Prototype, UiNode } from "../ui/schema.ts";
import { findNode, fromToolBatch } from "../ui/tree.ts";
import { tickAgreement } from "../consensus/doc.ts";
import type { ConsensusDoc, Decision } from "../consensus/doc.ts";
import { buildComparisonView } from "../session/runtime.ts";
import type { Log, SessionRuntime } from "../session/runtime.ts";
import type { StageEvent } from "../stage/channel.ts";
import type { Store, StoredEvent } from "../store.ts";

export const RUN_FLOOR_MS = 10_000;
export const TICK_MS = 1_000;
export const PLEASED_MS = 2_000;
const LABEL_MAX = 60;

const SYSTEM = readFileSync(new URL("./prompts/build.md", import.meta.url), "utf8");

export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms).unref(),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

const TOOLS: PortTool[] = [
  {
    name: "apply_patches",
    description:
      "Change the shared prototype with one small, atomic batch of patch ops. Call it whenever the hand-off " +
      "means the screen should change: a proposal to draw, a change to a drawn element, a removal, or a move to " +
      "another screen (set_screen). Call it several times for several separate changes, in the order they should " +
      "appear. A batch that fails validation is rejected whole and nothing renders.",
    strict: true,
    input_schema: strictCompatible(patchBatchJsonSchema()),
    schema: ToolPatchBatch,
  },
  {
    name: "update_consensus",
    description:
      "Record what the room has proposed, backed, objected to, asked or contested, and set the phase, the app " +
      "summary and nextUp. Call it once per hand-off with every op in order; call it whenever any of those changed. " +
      "Only people heard in the grounding lines can propose, support or object.",
    strict: true,
    input_schema: toolJsonSchema(UpdateConsensusInput),
    schema: UpdateConsensusInput,
  },
];

type SnapshotEvent = Extract<StageEvent, { type: "snapshot" }>;
const view = (rt: SessionRuntime) => rt.snapshot() as SnapshotEvent;

type SessionState = {
  port: ModelPort;
  inFlight: boolean;
  pending: Handoff | null;
  bypassFloor: boolean;
  lastRunAt: number | null;
  timer: unknown;
  tick: unknown;
  // Hand-offs accepted so far, and how many of them a finished run has covered.
  received: number;
  settled: number;
  // Per pending decision ("<id>@<pendingSince>") whose 30 s are up: `received` at that moment.
  due: Map<string, number>;
};

// What the room's pick did. "ignored": not acted on (ungrounded, an unknown conflict or label, or
// an error). "settled": the conflict was already resolved, so nothing is new. "merged": resolved
// now, with the winner on the prototype. "unmerged": resolved now, but the winner's batch no longer
// applies, so `redraw` asks the model to draw it again (known issue I3).
type Pick = { kind: "ignored" } | { kind: "settled" } | { kind: "merged" } | { kind: "unmerged"; redraw: Proposal };

function mergeHandoffs(a: Handoff, b: Handoff): Handoff {
  const merged: Handoff = {
    topics: [...a.topics, ...b.topics],
    mood: b.mood,
    groundingIds: [...new Set([...a.groundingIds, ...b.groundingIds])],
  };
  const requestedView = b.requestedView ?? a.requestedView;
  if (requestedView !== undefined) merged.requestedView = requestedView;
  return merged;
}

function userTurn(h: Handoff, grounding: StoredEvent[], doc: ConsensusDoc, proto: Prototype): string {
  const lines = grounding.map((e) => `[${e.id}] ${e.speaker ?? "Unknown"}: ${e.text ?? ""}`).join("\n");
  return [
    "A new hand-off from the conversation loop. Update the consensus document and the prototype to match it.",
    `<handoff>\n${JSON.stringify(h)}\n</handoff>`,
    `<grounding_lines>\n${lines}\n</grounding_lines>`,
    `<consensus_doc>\n${JSON.stringify(doc)}\n</consensus_doc>`,
    `<prototype current_screen="${proto.currentScreen}">\n${JSON.stringify(proto.root)}\n</prototype>`,
  ].join("\n\n");
}

// Ids a batch adds or changes (removals and screen switches leave nothing to mark).
function touchedIds(batch: PatchBatch): string[] {
  const ids: string[] = [];
  for (const op of batch.ops) {
    if (op.op === "add") ids.push(op.node.id);
    else if (op.op === "update" || op.op === "move") ids.push(op.id);
  }
  return [...new Set(ids)];
}

const batchLabel = (prefix: "Agreed" | "Reopened", text: string) => {
  const full = `${prefix}: ${text}`;
  return full.length <= LABEL_MAX ? full : `${full.slice(0, LABEL_MAX - 1)}…`;
};

const errorName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

export function createBuildLoop(deps: {
  port: ModelPort;
  runtime: (sessionId: string) => SessionRuntime;
  store: Store;
  clock: () => number;
  log?: Log;
  timers?: Timers;
  botName?: string;
}) {
  const { runtime, store, clock } = deps;
  const log: Log = deps.log ?? (() => {});
  const timers = deps.timers ?? realTimers;
  const botName = deps.botName ?? "Builder";
  const sessions = new Map<string, SessionState>();
  // Sessions whose call is over: no runs, no promotions, no hand-offs (known issue I5).
  const ended = new Set<string>();

  // The session's own utterances among the given ids, and the people (not Builder) who spoke them.
  function groundingFor(sessionId: string, groundingIds: number[]) {
    const ids = new Set(groundingIds);
    const lines = store.listEvents(sessionId).filter((e) => e.kind === "utterance" && ids.has(e.id));
    const speakers = new Set(lines.map((e) => e.speaker).filter((s): s is string => !!s && s !== botName));
    return { lines, speakers };
  }

  const state = (sessionId: string): SessionState => {
    let st = sessions.get(sessionId);
    if (!st) {
      st = {
        port: withCostRecording(deps.port, { store, sessionId }),
        inFlight: false, pending: null, bypassFloor: false, lastRunAt: null, timer: null, tick: null,
        received: 0, settled: 0, due: new Map(),
      };
      sessions.set(sessionId, st);
    }
    return st;
  };

  // Sets a decision's nodes (those it affects, then those drawn with its id) to one status in one
  // batch, skipping ids that no longer exist and nodes already in that state. Reopening leaves a
  // node that another decision has agreed since. The only code path that marks nodes agreed:
  // model batches are sanitised to draft.
  function flipNodes(sessionId: string, rt: SessionRuntime, d: Decision, status: "agreed" | "draft") {
    const proto = view(rt).proto;
    const drawn: string[] = [];
    const walk = (n: UiNode) => {
      if (n.decisionId === d.id) drawn.push(n.id);
      n.children.forEach(walk);
    };
    walk(proto.root);
    const flips = (n: UiNode | undefined) => !!n && (status === "agreed"
      ? n.status !== "agreed" || n.decisionId !== d.id
      : n.status === "agreed" && (n.decisionId === undefined || n.decisionId === d.id));
    const ids = [...new Set([...d.affects, ...drawn])].filter((id) => flips(findNode(proto, id)));
    if (!ids.length) return;
    const r = rt.applyBatch({
      label: batchLabel(status === "agreed" ? "Agreed" : "Reopened", d.text),
      ops: ids.map((id) => ({ op: "update", id, status, decisionId: d.id })),
    });
    if (!r.ok) log("build.flip_rejected", { session_id: sessionId, decision_id: d.id, status, ops: ids.length });
  }

  function promote(sessionId: string, rt: SessionRuntime, ids: string[], via: "support" | "timeout" | "conflict") {
    if (!ids.length) return;
    const doc = view(rt).doc;
    for (const id of ids) {
      const d = doc.decisions.find((x) => x.id === id);
      if (!d) continue;
      flipNodes(sessionId, rt, d, "agreed");
      log("build.promoted", { session_id: sessionId, decision_id: id, via });
    }
    rt.updateMoodInputs({ pleasedUntil: clock() + PLEASED_MS });
  }

  function stopTimers(st: SessionState) {
    if (st.timer !== null) timers.clearTimeout(st.timer);
    if (st.tick !== null) timers.clearInterval(st.tick);
    st.timer = null;
    st.tick = null;
  }

  function ensureTick(sessionId: string, st: SessionState) {
    if (ended.has(sessionId)) return stopTimers(st);
    let anyPending: boolean;
    try {
      anyPending = view(runtime(sessionId)).doc.decisions.some((d) => d.status === "pending");
    } catch (err) {
      log("build.tick_failed", { session_id: sessionId, error: errorName(err) });
      return;
    }
    if (anyPending && st.tick === null) {
      st.tick = timers.setInterval(() => tick(sessionId, st), TICK_MS);
    } else if (!anyPending && st.tick !== null) {
      timers.clearInterval(st.tick);
      st.tick = null;
    }
  }

  // A hand-off received before a pending decision's 30 s ran out can carry an objection to it, so
  // the promotion waits until every such hand-off has been applied (known issue M10). Hand-offs
  // received later don't hold it up, so the wait is at most the run in flight plus the next one.
  function objectionsApplied(st: SessionState, d: Decision): boolean {
    const key = `${d.id}@${d.pendingSince}`;
    let through = st.due.get(key);
    if (through === undefined) st.due.set(key, (through = st.received));
    return st.settled >= through;
  }

  function tick(sessionId: string, st: SessionState) {
    if (ended.has(sessionId)) return stopTimers(st);
    try {
      const rt = runtime(sessionId);
      const { doc, promoted } = tickAgreement(view(rt).doc, clock(), (d) => objectionsApplied(st, d));
      const waiting = new Set(doc.decisions.filter((d) => d.status === "pending").map((d) => `${d.id}@${d.pendingSince}`));
      for (const key of st.due.keys()) if (!waiting.has(key)) st.due.delete(key);
      if (promoted.length) {
        rt.setDoc(doc);
        promote(sessionId, rt, promoted, "timeout");
      }
    } catch (err) {
      log("build.tick_failed", { session_id: sessionId, error: errorName(err) });
    }
    ensureTick(sessionId, st);
  }

  // Applies the room's pick right away, then marks the winning variant's nodes agreed. Acts only
  // when a person (not Builder) in this session's grounding lines is behind the hand-off.
  function resolveChoice(sessionId: string, groundingIds: number[], choice: { conflictId: string; winner: "A" | "B" | "C" }): Pick {
    try {
      const { speakers } = groundingFor(sessionId, groundingIds);
      if (speakers.size === 0) {
        log("build.resolve_ungrounded", { session_id: sessionId, conflict_id: choice.conflictId, grounding: groundingIds.length });
        return { kind: "ignored" };
      }
      const rt = runtime(sessionId);
      const before = view(rt).doc;
      const conflict = before.conflicts.find((c) => c.id === choice.conflictId);
      const r = rt.resolveComparison(choice.conflictId, choice.winner);
      if (!r.ok) {
        log("build.resolve_failed", { session_id: sessionId, conflict_id: choice.conflictId });
        return { kind: "ignored" };
      }
      if (conflict?.status !== "open") return { kind: "settled" };
      const variant = conflict.variants.find((v) => v.label === choice.winner);
      const after = view(rt).doc;
      const decision = after.decisions.find((d) => !before.decisions.some((b) => b.id === d.id));
      if (variant && decision) {
        // A winner batch that did not apply changed nothing, so it marks nothing agreed.
        const proto = view(rt).proto;
        const touched = r.applied ? touchedIds(variant.batch).filter((id) => findNode(proto, id)) : [];
        const affects = [...new Set([...decision.affects, ...touched])];
        rt.setDoc({ ...after, decisions: after.decisions.map((d) => (d.id === decision.id ? { ...d, affects } : d)) });
        promote(sessionId, rt, [decision.id], "conflict");
      }
      if (r.applied) return { kind: "merged" };
      // Recorded, but the prototype doesn't show the winner: the model draws it again, credited to
      // someone heard in this hand-off (one of the winner's backers when one of them spoke).
      log("build.resolve_unmerged", { session_id: sessionId, conflict_id: choice.conflictId });
      const proposedBy = variant?.backers.find((b) => speakers.has(b)) ?? [...speakers][0];
      return {
        kind: "unmerged",
        redraw: {
          text: `Redraw option ${choice.winner} of conflict ${choice.conflictId}, which the room picked (decision d-${choice.conflictId}): ${variant?.summary ?? ""}`,
          proposedBy, supporters: [], objectors: [],
        },
      };
    } catch (err) {
      log("build.resolve_failed", { session_id: sessionId, conflict_id: choice.conflictId, error: errorName(err) });
      return { kind: "ignored" };
    }
  }

  function schedule(sessionId: string, st: SessionState) {
    if (st.inFlight || !st.pending || ended.has(sessionId)) return;
    const wait = st.bypassFloor || st.lastRunAt === null ? 0 : Math.max(0, st.lastRunAt + RUN_FLOOR_MS - clock());
    if (wait === 0) {
      if (st.timer !== null) {
        timers.clearTimeout(st.timer);
        st.timer = null;
      }
      run(sessionId, st).catch((err) => log("build.run_failed", { session_id: sessionId, error: errorName(err) }));
    } else if (st.timer === null) {
      st.timer = timers.setTimeout(() => {
        st.timer = null;
        schedule(sessionId, st);
      }, wait);
    }
  }

  function applyResult(sessionId: string, rt: SessionRuntime, result: RunToolsResult, speakers: Set<string>) {
    const counts = {
      patches_applied: 0, patches_rejected: 0, patches_empty: 0, consensus_invalid: 0, ops: 0, grounding_dropped: 0,
      promoted: 0, reopened: 0, conflicts: 0,
    };
    const ops: ConsensusUpdate[] = [];
    for (const call of result.toolCalls) {
      if (call.name !== "update_consensus") continue;
      const parsed = UpdateConsensusInput.safeParse(call.input);
      if (parsed.success) ops.push(...parsed.data.ops);
      else counts.consensus_invalid++;
    }
    const grounded = enforceGrounding(ops, speakers);
    counts.ops = grounded.ops.length;
    counts.grounding_dropped = grounded.dropped;
    // The agreed decisions this run's ops reopen: only their nodes may a batch remove (known issue I2).
    const current = view(rt).doc;
    const planned = applyConsensusOps(current, grounded.ops, clock()).doc;
    const reopening = new Set(current.decisions
      .filter((d) => d.status === "agreed" && planned.decisions.find((p) => p.id === d.id)?.status !== "agreed")
      .map((d) => d.id));

    // Patches first, so decisions and conflicts can reference the nodes they add.
    for (const call of result.toolCalls) {
      if (call.name !== "apply_patches") continue;
      const parsed = ToolPatchBatch.safeParse(call.input);
      if (!parsed.success) {
        counts.patches_rejected++;
        log("build.batch_rejected", { session_id: sessionId, reason: "invalid_input" });
        continue;
      }
      const credit = groundCredit(parsed.data, speakers);
      counts.grounding_dropped += credit.dropped;
      const snap = view(rt);
      const batch = sanitizeModelBatch(fromToolBatch(credit.batch), snap.doc, { proto: snap.proto, reopened: reopening });
      // Every op changed nothing or would have changed what was agreed: nothing to draw.
      if (!batch.ops.length) {
        counts.patches_empty++;
        continue;
      }
      const r = rt.applyBatch(batch);
      if (r.ok) counts.patches_applied++;
      else {
        counts.patches_rejected++;
        log("build.batch_rejected", { session_id: sessionId, reason: "does_not_apply", ops: parsed.data.ops.length });
      }
    }

    if (grounded.ops.length) {
      // Applied to the doc as it is now, so a promotion made during the run is kept.
      const before = view(rt).doc;
      const { doc, addedConflicts } = applyConsensusOps(before, grounded.ops, clock());
      rt.setDoc(doc);
      const wasAgreed = (id: string) => before.decisions.find((b) => b.id === id)?.status === "agreed";
      const promoted = doc.decisions.filter((d) => d.status === "agreed" && !wasAgreed(d.id)).map((d) => d.id);
      counts.promoted = promoted.length;
      promote(sessionId, rt, promoted, "support");
      // An objection to an agreed decision sends its nodes back to draft.
      const reopened = doc.decisions.filter((d) => d.status !== "agreed" && wasAgreed(d.id));
      counts.reopened = reopened.length;
      for (const d of reopened) {
        flipNodes(sessionId, rt, d, "draft");
        log("build.reopened", { session_id: sessionId, decision_id: d.id });
      }
      // One comparison on screen at a time (known issue M1): a new conflict shows only when none is
      // shown. The others wait in the doc, and the runtime shows the next when the one shown resolves.
      for (const id of addedConflicts) {
        const conflict = doc.conflicts.find((c) => c.id === id)!;
        const comparison = buildComparisonView(view(rt).proto, conflict);
        if (!comparison) {
          log("build.comparison_skipped", { session_id: sessionId, conflict_id: id });
          continue;
        }
        counts.conflicts++;
        if (view(rt).comparison === null) rt.showComparison(comparison);
        else log("build.comparison_queued", { session_id: sessionId, conflict_id: id });
      }
    }
    return counts;
  }

  async function run(sessionId: string, st: SessionState) {
    const h = st.pending!;
    const through = st.received; // every hand-off received so far is in this run or an earlier one
    st.pending = null;
    st.bypassFloor = false;
    st.inFlight = true;
    st.lastRunAt = clock();
    let rt: SessionRuntime | null = null;
    let region = false;
    let stage = "setup";
    try {
      const live = runtime(sessionId);
      rt = live;
      live.updateMoodInputs({ buildInFlight: true, buildStreaming: false });
      const { lines: grounding, speakers } = groundingFor(sessionId, h.groundingIds);
      const { doc, proto } = view(live);

      // Streaming: "building" from the first input delta, and a placeholder where the
      // first added node is going, from the first complete add parentId.
      let streaming = false;
      let buf = "";
      const parentRe = /"parentId"\s*:\s*"([a-z0-9][a-z0-9.-]{0,63})"/g;
      const onToolInputDelta = (tool: string, partial: string) => {
        if (!streaming) {
          streaming = true;
          live.updateMoodInputs({ buildStreaming: true });
        }
        if (region || tool !== "apply_patches") return;
        buf += partial;
        // parentRe.lastIndex only moves past complete matches, so each byte is scanned about once.
        for (let m = parentRe.exec(buf); m; m = parentRe.exec(buf)) {
          if (/"op"\s*:\s*"add"/.test(buf.slice(buf.lastIndexOf("{", m.index), m.index))) {
            region = true;
            live.pendingRegion(m[1]);
            return;
          }
        }
        parentRe.lastIndex = Math.max(0, buf.length - 100);
      };

      stage = "model";
      const result = await st.port.runTools({
        loop: "build", system: SYSTEM, tools: TOOLS, effort: "medium", onToolInputDelta,
        messages: [{ role: "user", content: userTurn(h, grounding, doc, proto) }],
      });
      stage = "apply";
      const base = {
        session_id: sessionId, stop_reason: result.stopReason, tool_calls: result.toolCalls.length,
        dropped: result.dropped, ms: Math.round(result.ms), topics: h.topics.length, grounding: grounding.length,
      };
      // A refusal or no usable call leaves the screen and the doc as they are, and so does a call
      // that ended while the model was working: the handoff is already final.
      if (ended.has(sessionId)) log("build.run", { ...base, discarded: "ended" });
      else if (result.stopReason === "refusal" || result.toolCalls.length === 0) log("build.run", base);
      else log("build.run", { ...base, ...applyResult(sessionId, live, result, speakers) });
    } catch (err) {
      log("build.run_failed", {
        session_id: sessionId, stage, error: errorName(err),
        status: (err as { status?: unknown } | null)?.status ?? null,
      });
    } finally {
      st.inFlight = false;
      st.settled = Math.max(st.settled, through);
      try {
        if (rt && region) rt.pendingRegion(null);
        rt?.updateMoodInputs({ buildInFlight: false, buildStreaming: false });
      } catch (err) {
        log("build.cleanup_failed", { session_id: sessionId, error: errorName(err) });
      }
      ensureTick(sessionId, st);
      schedule(sessionId, st);
    }
  }

  return {
    handoff(sessionId: string, input: Handoff): void {
      if (ended.has(sessionId)) {
        log("build.handoff_ignored", { session_id: sessionId, reason: "ended" });
        return;
      }
      const parsed = HandoffSchema.safeParse(input);
      if (!parsed.success) {
        log("build.handoff_invalid", { session_id: sessionId, issues: parsed.error.issues.length });
        return;
      }
      const st = state(sessionId);
      st.received++;
      log("build.handoff", { session_id: sessionId, topics: parsed.data.topics.length, grounding: parsed.data.groundingIds.length });
      // The model sees resolvedChoice only for a pick merged just now, so "already merged" is true
      // (known issue I3). A pick not acted on, or for a conflict resolved before, is removed; a new
      // pick whose winner no longer applies becomes a proposal to draw it again.
      let resolved = false;
      const topics = parsed.data.topics.map((t) => {
        if (!t.resolvedChoice) return t;
        const pick = resolveChoice(sessionId, parsed.data.groundingIds, t.resolvedChoice);
        if (pick.kind === "merged") {
          resolved = true;
          return t;
        }
        const { resolvedChoice: _dropped, ...rest } = t;
        if (pick.kind !== "unmerged") return rest;
        resolved = true;
        return { ...rest, proposals: [...rest.proposals, pick.redraw] };
      });
      const h: Handoff = { ...parsed.data, topics };
      st.pending = st.pending ? mergeHandoffs(st.pending, h) : h;
      if (resolved) st.bypassFloor = true;
      schedule(sessionId, st);
      ensureTick(sessionId, st);
    },

    // After a restart (known issue M2): the no-objection timer runs again for decisions still pending.
    resume(sessionId: string): void {
      if (!ended.has(sessionId)) ensureTick(sessionId, state(sessionId));
    },

    // The call is over: clear the timers, drop pending work and ignore later hand-offs. Pending
    // decisions stay pending; the handoff flags them as not agreed.
    end(sessionId: string): void {
      ended.add(sessionId);
      const st = sessions.get(sessionId);
      if (st) {
        stopTimers(st);
        st.pending = null;
        st.bypassFloor = false;
        sessions.delete(sessionId); // a run still in flight keeps its own reference
      }
      log("build.ended", { session_id: sessionId, in_flight: st?.inFlight ?? false });
    },

    idle(sessionId: string): boolean {
      const st = sessions.get(sessionId);
      return !st || (!st.inFlight && st.pending === null && st.timer === null);
    },
  };
}
