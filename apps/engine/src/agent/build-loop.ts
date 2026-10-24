// Build loop: turns conversation hand-offs into consensus-document updates and
// prototype patches with Sonnet. One run in flight per session; hand-offs that arrive
// meanwhile merge into the next run, at most one run per 3 s unless a conflict was
// just resolved. Each patch batch is applied as soon as the model finishes writing it.
// Also promotes pending decisions after 30 s without objection. When the call ends,
// end() stops all of it, so the consensus and the handoff are final (spec §14).
// Logs ids, counts and durations only: never transcript text, prompts or model output.
import { withCostRecording } from "./cost.ts";
import { buildSystemPrompt } from "./prompt-catalog.ts";
import { strictCompatible, toolJsonSchema } from "./tool-schema.ts";
import type { ModelPort, PortTool, RunToolsResult, ToolCall } from "./llm.ts";
import { applyConsensusOps, enforceGrounding, groundCredit, HandoffSchema, sanitizeModelBatch, UpdateConsensusInput } from "./handoff.ts";
import type { ConsensusUpdate, Handoff, Proposal } from "./handoff.ts";
import { offeredOnly, patchBatchJsonSchema, ToolPatchBatch } from "../ui/schema.ts";
import type { PatchBatch, PatchOp, Prototype, UiNode } from "../ui/schema.ts";
import { findNode, fromToolBatch, themeStatusOp } from "../ui/tree.ts";
import { tickAgreement } from "../consensus/doc.ts";
import type { ConsensusDoc, Decision } from "../consensus/doc.ts";
import { buildComparisonView } from "../session/runtime.ts";
import type { Log, SessionRuntime } from "../session/runtime.ts";
import type { BuildTask, StageEvent } from "../stage/channel.ts";
import type { Store, StoredEvent } from "../store.ts";
import { errorCode } from "../error-code.ts";
import { matchSpokenPick } from "./spoken-pick.ts";
import { DEFAULT_THEME_VALUES, THEME_SLOTS } from "../../public/renderer/theme.js";

export const RUN_FLOOR_MS = 3_000;
export const TICK_MS = 1_000;
export const PLEASED_MS = 2_000;
export const TASK_DONE_MS = 3_000;
const TASK_MAX = 40;
const LABEL_MAX = 60;
// How long after a pick a spoken agreement with it still counts.
export const LATE_AGREE_MS = 20_000;

// Built once at module load, so the text is identical on every call and the prompt cache hits.
const SYSTEM = buildSystemPrompt();

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
    input_schema: offeredOnly(toolJsonSchema(UpdateConsensusInput)),
    schema: UpdateConsensusInput,
  },
];

// What a topic shows in the to-do list: its own short task line, else its title.
export function taskText(t: Handoff["topics"][number]): string {
  const text = (t.task?.trim() || t.title.trim());
  return text.length <= TASK_MAX ? text : `${text.slice(0, TASK_MAX - 1).trimEnd()}…`;
}

type SnapshotEvent = Extract<StageEvent, { type: "snapshot" }>;
const view = (rt: SessionRuntime) => rt.snapshot() as SnapshotEvent;

type SessionState = {
  port: ModelPort;
  inFlight: boolean;
  pending: Handoff | null;
  pendingTaskIds: string[];
  tasks: BuildTask[];
  taskSeq: number;
  pendingSince: number | null;
  bypassFloor: boolean;
  lastRunAt: number | null;
  timer: unknown;
  tick: unknown;
  // Hand-offs accepted so far, how many of them are merged into `pending` (they merge in the order they
  // arrived), and how many a finished run has covered.
  received: number;
  merged: number;
  settled: number;
  // A hand-off with a pick reads its grounding lines from the database first. Hand-offs after it wait
  // here, so they still merge in the order they arrived.
  intake: Promise<void> | null;
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

// The theme as one line: each slot's value, status and decision, or the house default.
function themeLine(proto: Prototype): string {
  if (!proto.theme) return `theme: house default (${THEME_SLOTS.map((s) => `${s}=${DEFAULT_THEME_VALUES[s]}`).join(", ")}), all agreed`;
  const theme = proto.theme;
  return `theme: ${THEME_SLOTS.map((s) => {
    const slot = theme[s];
    return `${s}=${slot.value} (${[slot.status, ...(slot.decisionId ? [slot.decisionId] : [])].join(", ")})`;
  }).join("; ")}`;
}

function userTurn(h: Handoff, grounding: StoredEvent[], doc: ConsensusDoc, proto: Prototype): string {
  const lines = grounding.map((e) => `[${e.id}] ${e.speaker ?? "Unknown"}: ${e.text ?? ""}`).join("\n");
  return [
    "A new hand-off from the conversation loop. Update the consensus document and the prototype to match it.",
    `<handoff>\n${JSON.stringify(h)}\n</handoff>`,
    `<grounding_lines>\n${lines}\n</grounding_lines>`,
    `<consensus_doc>\n${JSON.stringify(doc)}\n</consensus_doc>`,
    `<prototype current_screen="${proto.currentScreen}">\n${themeLine(proto)}\n${JSON.stringify(proto.root)}\n</prototype>`,
  ].join("\n\n");
}

// Ids of the Screens in a prototype.
function screenIds(proto: Prototype): Set<string> {
  const ids = new Set<string>();
  const walk = (n: UiNode) => { if (n.type === "Screen") ids.add(n.id); n.children.forEach(walk); };
  walk(proto.root);
  return ids;
}

// Ids a batch adds or changes (removals and screen switches leave nothing to mark).
function changedIds(batch: PatchBatch): string[] {
  const ids: string[] = [];
  for (const op of batch.ops) {
    if (op.op === "add") ids.push(op.node.id);
    else if (op.op === "update" || op.op === "move") ids.push(op.id);
  }
  return [...new Set(ids)];
}

const batchLabel = (prefix: "Agreed" | "Reopened" | "Reverted", text: string) => {
  const full = `${prefix}: ${text}`;
  return full.length <= LABEL_MAX ? full : `${full.slice(0, LABEL_MAX - 1)}…`;
};


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
  // `stored` is the session's events from the store.
  function groundingFor(stored: StoredEvent[], groundingIds: number[]) {
    const ids = new Set(groundingIds);
    const lines = stored.filter((e) => e.kind === "utterance" && ids.has(e.id));
    const speakers = new Set(lines.map((e) => e.speaker).filter((s): s is string => !!s && s !== botName));
    return { lines, speakers };
  }

  const state = (sessionId: string): SessionState => {
    let st = sessions.get(sessionId);
    if (!st) {
      st = {
        port: withCostRecording(deps.port, { store, sessionId, log }),
        inFlight: false, pending: null, pendingTaskIds: [], tasks: [], taskSeq: 0, pendingSince: null, bypassFloor: false, lastRunAt: null, timer: null, tick: null,
        received: 0, merged: 0, settled: 0, intake: null, due: new Map(),
      };
      sessions.set(sessionId, st);
    }
    return st;
  };

  // Sets a decision's nodes (those it affects, then those drawn with its id) to one status in one
  // batch, skipping ids that no longer exist and nodes already in that state. Reopening leaves a
  // node that another decision has agreed since. Agreeing also agrees the theme slots it set, in the
  // same batch. The only code path that marks nodes or theme slots agreed: model batches are
  // sanitised to draft.
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
    const ops: PatchOp[] = ids.map((id) => ({ op: "update", id, status, decisionId: d.id }));
    const theme = status === "agreed" ? themeStatusOp(proto, d.id, "agreed") : null;
    if (theme) ops.push(theme);
    if (!ops.length) return;
    const r = rt.applyBatch({ label: batchLabel(status === "agreed" ? "Agreed" : "Reopened", d.text), ops });
    if (!r.ok) log("build.flip_rejected", { session_id: sessionId, decision_id: d.id, status, ops: ops.length });
  }

  // Puts the theme slots a decision set back to their last agreed value, in their own batch. Only a
  // decision left in draft: one backed again in the same run (pending) keeps its theme up. The slot
  // remembers what was taken off, so agreeing the decision later puts it back.
  function revertTheme(sessionId: string, rt: SessionRuntime, d: Decision | undefined) {
    if (!d || d.status !== "draft") return;
    const op = themeStatusOp(view(rt).proto, d.id, "revert");
    if (!op) return;
    const r = rt.applyBatch({ label: batchLabel("Reverted", d.text), ops: [op] });
    if (r.ok) log("build.theme_reverted", { session_id: sessionId, decision_id: d.id });
    else log("build.flip_rejected", { session_id: sessionId, decision_id: d.id, status: "revert", ops: 1 });
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
      log("build.tick_failed", { session_id: sessionId, error: errorCode(err) });
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
      log("build.tick_failed", { session_id: sessionId, error: errorCode(err) });
    }
    ensureTick(sessionId, st);
  }

  // Applies the room's pick right away, then marks the winning variant's nodes agreed. Acts only
  // when a person (not Builder) in this session's grounding lines is behind the hand-off.
  function resolveChoice(sessionId: string, stored: StoredEvent[], groundingIds: number[], picked: { conflictId: string; winner: "A" | "B" | "C" }): Pick {
    let choice = picked;
    try {
      const { lines, speakers } = groundingFor(stored, groundingIds);
      if (speakers.size === 0) {
        log("build.resolve_ungrounded", { session_id: sessionId, conflict_id: choice.conflictId, grounding: groundingIds.length });
        return { kind: "ignored" };
      }
      const rt = runtime(sessionId);
      const before = view(rt).doc;
      // "*", or an id that names no conflict, means the only open conflict.
      if (!before.conflicts.some((c) => c.id === choice.conflictId)) {
        const open = before.conflicts.filter((c) => c.status === "open");
        if (open.length !== 1) {
          log("build.resolve_ambiguous", { session_id: sessionId, open: open.length });
          return { kind: "ignored" };
        }
        choice = { conflictId: open[0].id, winner: choice.winner };
      }
      const conflict = before.conflicts.find((c) => c.id === choice.conflictId);
      // Only a speaker whose own grounding line picks the winner is recorded as agreeing, in the order
      // of those lines; a loosely phrased pick still resolves but records just the backers.
      const winner = choice.winner;
      const pickers = [...new Set(lines.filter((e) => e.speaker && speakers.has(e.speaker) && matchSpokenPick(e.text ?? "", [winner]) === winner).map((e) => e.speaker as string))];
      const r = rt.resolveComparison(choice.conflictId, winner, pickers);
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
        const touched = r.applied ? changedIds(variant.batch).filter((id) => findNode(proto, id)) : [];
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
      log("build.resolve_failed", { session_id: sessionId, conflict_id: choice.conflictId, error: errorCode(err) });
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
      run(sessionId, st).catch((err) => log("build.run_failed", { session_id: sessionId, error: errorCode(err) }));
    } else if (st.timer === null) {
      st.timer = timers.setTimeout(() => {
        st.timer = null;
        schedule(sessionId, st);
      }, wait);
    }
  }

  // Pushes the session's list to the stage, ordered now, queued, done. A failed push is logged and
  // never wedges the loop. Logs counts only, never task text.
  function pushTasks(sessionId: string, st: SessionState) {
    const rank = { now: 0, queued: 1, done: 2 };
    const list = [...st.tasks].sort((a, b) => rank[a.state] - rank[b.state]);
    try {
      runtime(sessionId).setTasks(list);
      log("build.tasks", {
        session_id: sessionId, now: list.filter((t) => t.state === "now").length,
        queued: list.filter((t) => t.state === "queued").length, done: list.filter((t) => t.state === "done").length,
      });
    } catch (err) {
      log("build.tasks_failed", { session_id: sessionId, error: errorCode(err) });
    }
  }

  // Marks a run's tasks done and removes them after TASK_DONE_MS, or removes them at once.
  function finishTasks(sessionId: string, st: SessionState, ids: string[], applied: boolean) {
    const mine = new Set(ids);
    if (applied) {
      st.tasks = st.tasks.map((t) => (mine.has(t.id) ? { ...t, state: "done" } : t));
      timers.setTimeout(() => {
        st.tasks = st.tasks.filter((t) => !mine.has(t.id));
        pushTasks(sessionId, st);
      }, TASK_DONE_MS);
    } else {
      st.tasks = st.tasks.filter((t) => !mine.has(t.id));
    }
    pushTasks(sessionId, st);
  }

  // A model batch as the room may see it: its credit grounded and its ops sanitised (known issues
  // I2 and M9). `reopened` names the agreed decisions this run reopens; only their nodes may go.
  // `propsDropped` counts props the catalog does not allow (unknown keys, wrong kinds, enum misses);
  // `unoffered` counts adds of a type the model is not offered, skipped one by one (ADR 0017).
  function prepareBatch(input: ToolPatchBatch, rt: SessionRuntime, speakers: Set<string>, reopened: Set<string>) {
    const credit = groundCredit(input, speakers);
    const snap = view(rt);
    const { batch, dropped, unoffered } = fromToolBatch(credit.batch, {}, snap.proto);
    return { batch: sanitizeModelBatch(batch, snap.doc, { proto: snap.proto, reopened }), creditDropped: credit.dropped, propsDropped: dropped, unoffered };
  }

  // Ids and counts only: never the props themselves.
  function logPropsDropped(sessionId: string, count: number, source?: "conflict") {
    if (count > 0) log("build.props_dropped", { session_id: sessionId, count, ...(source ? { source } : {}) });
  }

  type PatchCounts = { applied: number; rejected: number; empty: number; creditDropped: number; unoffered: number };

  // Applies one prepared batch and counts what happened. True when it changed the screen.
  function applyPrepared(sessionId: string, rt: SessionRuntime, batch: PatchBatch, opsGiven: number, counts: PatchCounts): boolean {
    // Every op changed nothing or would have changed what was agreed: nothing to draw.
    if (!batch.ops.length) {
      counts.empty++;
      return false;
    }
    const r = rt.applyBatch(batch);
    if (r.ok) counts.applied++;
    else {
      counts.rejected++;
      log("build.batch_rejected", { session_id: sessionId, reason: "does_not_apply", ops: opsGiven });
    }
    return r.ok;
  }

  // apply_patches calls were applied while streaming, except `deferred` ones: batches removing an
  // agreed node, which wait for this run's consensus ops to say whether its decision reopens.
  function applyResult(
    sessionId: string, rt: SessionRuntime, result: RunToolsResult, speakers: Set<string>,
    patchCounts: PatchCounts, deferred: ToolPatchBatch[],
  ) {
    const ops: ConsensusUpdate[] = [];
    let consensusInvalid = 0;
    for (const call of result.toolCalls) {
      if (call.name !== "update_consensus") continue;
      const parsed = UpdateConsensusInput.safeParse(call.input);
      if (parsed.success) ops.push(...parsed.data.ops);
      else consensusInvalid++;
    }
    // The proposers of decisions still open in the doc were grounded when those were recorded.
    const priorBackers = view(rt).doc.decisions
      .filter((d) => d.status === "draft" || d.status === "pending")
      .map((d) => ({ names: [d.proposedBy], affects: d.affects }));
    const grounded = enforceGrounding(ops, speakers, priorBackers, screenIds(view(rt).proto));
    // The agreed decisions this run's ops reopen: only their nodes may a batch remove (known issue I2).
    const current = view(rt).doc;
    const planned = applyConsensusOps(current, grounded.ops, clock(), view(rt).proto).doc;
    const reopening = new Set(current.decisions
      .filter((d) => d.status === "agreed" && planned.decisions.find((p) => p.id === d.id)?.status !== "agreed")
      .map((d) => d.id));

    // Deferred patches before the ops, so decisions and conflicts can reference the nodes they add.
    for (const input of deferred) {
      const { batch, creditDropped, propsDropped, unoffered } = prepareBatch(input, rt, speakers, reopening);
      patchCounts.creditDropped += creditDropped;
      patchCounts.unoffered += unoffered;
      logPropsDropped(sessionId, propsDropped);
      applyPrepared(sessionId, rt, batch, input.ops.length, patchCounts);
    }
    const counts = {
      patches_applied: patchCounts.applied, patches_rejected: patchCounts.rejected, patches_empty: patchCounts.empty,
      consensus_invalid: consensusInvalid, ops: grounded.ops.length, grounding_dropped: grounded.dropped + patchCounts.creditDropped,
      promoted: 0, reopened: 0, conflicts: 0, ops_unoffered: 0,
    };

    if (grounded.ops.length) {
      // Applied to the doc as it is now, so a promotion made during the run is kept.
      const before = view(rt).doc;
      const { doc, addedConflicts, propsDropped, unoffered } = applyConsensusOps(before, grounded.ops, clock(), view(rt).proto);
      patchCounts.unoffered += unoffered;
      rt.setDoc(doc);
      logPropsDropped(sessionId, propsDropped, "conflict");
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
      // An objection takes a theme back to its last agreed value, whether the decision was a draft or
      // agreed (spec 4.4), unless the same run backed it again. The system does this from the stored
      // value, not the model.
      for (const id of new Set(grounded.ops.flatMap((op) => (op.op === "object" ? [op.decisionId] : [])))) {
        revertTheme(sessionId, rt, doc.decisions.find((d) => d.id === id));
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
    counts.ops_unoffered = patchCounts.unoffered;
    return counts;
  }

  async function run(sessionId: string, st: SessionState) {
    const h = st.pending!;
    const through = st.merged; // every hand-off merged so far is in this run or an earlier one
    const taskIds = st.pendingTaskIds;
    st.pendingTaskIds = [];
    const startedAt = clock();
    const waitMs = st.pendingSince === null ? 0 : startedAt - st.pendingSince;
    st.pending = null;
    st.pendingSince = null;
    st.bypassFloor = false;
    st.inFlight = true;
    st.lastRunAt = startedAt;
    const running = new Set(taskIds);
    st.tasks = st.tasks.map((t) => (running.has(t.id) ? { ...t, state: "now" } : t));
    pushTasks(sessionId, st);
    const patchCounts: PatchCounts = { applied: 0, rejected: 0, empty: 0, creditDropped: 0, unoffered: 0 };
    const deferred: ToolPatchBatch[] = [];
    let opsApplied = 0;
    let droppedCalls = 0;
    let rt: SessionRuntime | null = null;
    let region = false;
    let stage = "setup";
    try {
      const live = runtime(sessionId);
      rt = live;
      live.updateMoodInputs({ buildInFlight: true, buildStreaming: false });
      const { lines: grounding, speakers } = groundingFor(await store.listEvents(sessionId), h.groundingIds);
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

      // Each patch batch is applied as soon as its block closes, so it shows while the model keeps writing.
      // Never throws: a throw would reject runTools and lose the cost row for a billed call.
      let firstPatchMs: number | null = null;
      let lastPatchMs: number | null = null;
      const onToolCall = (call: ToolCall) => {
        if (call.name !== "apply_patches" || ended.has(sessionId)) return;
        try {
          const parsed = ToolPatchBatch.safeParse(call.input);
          if (!parsed.success) {
            patchCounts.rejected++;
            log("build.batch_rejected", { session_id: sessionId, reason: "invalid_input" });
            return;
          }
          // A batch this run's reopenings could change (it removes an agreed node) waits for them.
          const agreedIds = new Set(view(live).doc.decisions.filter((d) => d.status === "agreed").map((d) => d.id));
          const { batch, creditDropped, propsDropped, unoffered } = prepareBatch(parsed.data, live, speakers, new Set());
          if (batch.ops.length !== prepareBatch(parsed.data, live, speakers, agreedIds).batch.ops.length) {
            deferred.push(parsed.data);
            return;
          }
          patchCounts.creditDropped += creditDropped;
          patchCounts.unoffered += unoffered;
          logPropsDropped(sessionId, propsDropped);
          if (!applyPrepared(sessionId, live, batch, parsed.data.ops.length, patchCounts)) return;
          lastPatchMs = clock() - startedAt;
          firstPatchMs ??= lastPatchMs;
          // The placeholder has been filled; a later add may show a new one.
          if (region) {
            live.pendingRegion(null);
            region = false;
            buf = "";
            parentRe.lastIndex = 0;
          }
        } catch (err) {
          log("build.stream_apply_failed", { session_id: sessionId, error: errorCode(err) });
        }
      };

      stage = "model";
      const result = await st.port.runTools({
        loop: "build", system: SYSTEM, tools: TOOLS, effort: "low", onToolInputDelta, onToolCall,
        messages: [{ role: "user", content: userTurn(h, grounding, doc, proto) }],
      });
      stage = "apply";
      droppedCalls = result.dropped;
      const base = {
        session_id: sessionId, stop_reason: result.stopReason, tool_calls: result.toolCalls.length,
        dropped: result.dropped, ms: Math.round(result.ms), topics: h.topics.length, grounding: grounding.length,
        wait_ms: waitMs, first_patch_ms: firstPatchMs, last_patch_ms: lastPatchMs,
      };
      // A refusal or no usable call leaves the doc as it is (batches already streamed stay on screen),
      // and so does a call that ended while the model was working: the handoff is already final.
      const streamedCounts = { patches_applied: patchCounts.applied, patches_rejected: patchCounts.rejected, patches_empty: patchCounts.empty, ops_unoffered: patchCounts.unoffered };
      if (ended.has(sessionId)) log("build.run", { ...base, ...streamedCounts, discarded: "ended" });
      else if (result.stopReason === "refusal" || result.toolCalls.length === 0) log("build.run", { ...base, ...streamedCounts });
      else {
        const counts = applyResult(sessionId, live, result, speakers, patchCounts, deferred);
        opsApplied = counts.ops;
        log("build.run", { ...base, ...counts });
      }
    } catch (err) {
      log("build.run_failed", {
        session_id: sessionId, stage, error: errorCode(err),
        status: (err as { status?: unknown } | null)?.status ?? null,
      });
    } finally {
      st.inFlight = false;
      st.settled = Math.max(st.settled, through);
      try {
        if (rt && region) rt.pendingRegion(null);
        rt?.updateMoodInputs({ buildInFlight: false, buildStreaming: false });
      } catch (err) {
        log("build.cleanup_failed", { session_id: sessionId, error: errorCode(err) });
      }
      // A run that only recorded consensus is done, unless the model's tool calls were dropped: then what it
      // meant to draw is missing, and the list shouldn't say otherwise.
      finishTasks(sessionId, st, taskIds, patchCounts.applied > 0 || (opsApplied > 0 && droppedCalls === 0));
      ensureTick(sessionId, st);
      schedule(sessionId, st);
    }
  }

  // Merges an accepted hand-off into the pending one and schedules a run. `stored` is the session's events,
  // read only when the hand-off carries a pick.
  function take(sessionId: string, st: SessionState, input: Handoff, stored: StoredEvent[]): void {
    // Counted first, so a hand-off lost to an error here can't hold a promotion back for good.
    st.merged++;
    // The model sees resolvedChoice only for a pick merged just now, so "already merged" is true
    // (known issue I3). A pick not acted on, or for a conflict resolved before, is removed; a new
    // pick whose winner no longer applies becomes a proposal to draw it again.
    let resolved = false;
    const topics = input.topics.map((t) => {
      if (!t.resolvedChoice) return t;
      const pick = resolveChoice(sessionId, stored, input.groundingIds, t.resolvedChoice);
      if (pick.kind === "merged") {
        resolved = true;
        return t;
      }
      const { resolvedChoice: _dropped, ...rest } = t;
      if (pick.kind !== "unmerged") return rest;
      resolved = true;
      return { ...rest, proposals: [...rest.proposals, pick.redraw] };
    });
    const h: Handoff = { ...input, topics };
    if (!st.pending) st.pendingSince = clock();
    st.pending = st.pending ? mergeHandoffs(st.pending, h) : h;
    const ids: string[] = [];
    for (const t of topics) {
      const text = taskText(t);
      if (!text) continue;
      const id = `t${++st.taskSeq}`;
      st.tasks.push({ id, text, state: "queued" });
      ids.push(id);
    }
    st.pendingTaskIds.push(...ids);
    pushTasks(sessionId, st);
    if (resolved) st.bypassFloor = true;
    schedule(sessionId, st);
    ensureTick(sessionId, st);
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
      const picks = parsed.data.topics.some((t) => t.resolvedChoice);
      // Without a pick, and nothing ahead of it, a hand-off is taken at once, as before.
      if (!picks && !st.intake) return take(sessionId, st, parsed.data, []);
      const intake: Promise<void> = (st.intake ?? Promise.resolve())
        .then(async () => {
          let stored: StoredEvent[] = [];
          // Unread grounding grounds nobody, so a pick is not acted on: agreement needs real lines (spec §4).
          if (picks) stored = await store.listEvents(sessionId).catch((err) => {
            log("build.grounding_failed", { session_id: sessionId, error: errorCode(err) });
            return [];
          });
          if (!ended.has(sessionId)) take(sessionId, st, parsed.data, stored);
        })
        .catch((err) => log("build.handoff_failed", { session_id: sessionId, error: errorCode(err) }))
        .finally(() => { if (st.intake === intake) st.intake = null; });
      st.intake = intake;
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

    // While a hand-off is still being taken, a promise that settles once the ones received so far are; null when
    // nothing is pending. A pick reads its grounding lines from the store first, so the conflict it settles is
    // resolved (and the winner merged) only then. Commands and speech in the same turn wait for this.
    taken(sessionId: string): Promise<void> | null {
      return sessions.get(sessionId)?.intake ?? null;
    },

    // A person's line agreeing with a pick made seconds ago ("Agreed, B it is" once the comparison has closed).
    // Adds that one speaker to the pick's decision, only if the stored line is theirs, names that winner and the
    // decision is at most LATE_AGREE_MS old. Idempotent. Returns whether the decision changed.
    async lateAgree(sessionId: string, a: { conflictId: string; winner: "A" | "B" | "C"; lineId: number }): Promise<boolean> {
      try {
        if (ended.has(sessionId)) return false;
        const line = (await store.listEvents(sessionId)).find((e) => e.kind === "utterance" && e.id === a.lineId);
        if (ended.has(sessionId) || !line?.text || !line.speaker || line.speaker === botName) return false;
        if (matchSpokenPick(line.text, [a.winner]) !== a.winner) return false;
        const rt = runtime(sessionId);
        const doc = view(rt).doc;
        const decision = doc.decisions.find((d) => d.id === `d-${a.conflictId}`);
        const conflict = doc.conflicts.find((c) => c.id === a.conflictId);
        if (!decision || conflict?.status !== "resolved" || conflict.winner !== a.winner) return false;
        if (decision.decidedAt === undefined || clock() - decision.decidedAt > LATE_AGREE_MS) return false;
        if (decision.agreedBy.includes(line.speaker)) return false;
        const speaker = line.speaker;
        rt.setDoc({ ...doc, decisions: doc.decisions.map((d) => (d.id === decision.id ? { ...d, agreedBy: [...d.agreedBy, speaker] } : d)) });
        return true;
      } catch (err) {
        log("build.late_agree_failed", { session_id: sessionId, error: errorCode(err) });
        return false;
      }
    },

    idle(sessionId: string): boolean {
      const st = sessions.get(sessionId);
      return !st || (!st.inFlight && st.pending === null && st.timer === null && st.intake === null);
    },
  };
}
