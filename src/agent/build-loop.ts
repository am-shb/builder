// Build loop: turns conversation hand-offs into consensus-document updates and
// prototype patches with Opus. One run in flight per session; hand-offs that arrive
// meanwhile merge into the next run, at most one run per 3 s unless a conflict was
// just resolved. Each patch batch is applied as soon as the model finishes writing it. Also promotes pending decisions after 30 s without objection.
// Logs ids, counts and durations only: never transcript text, prompts or model output.
import { readFileSync } from "node:fs";
import { withCostRecording } from "./cost.ts";
import { strictCompatible, toolJsonSchema } from "./tool-schema.ts";
import type { ModelPort, PortTool, RunToolsResult, ToolCall } from "./llm.ts";
import { applyConsensusOps, enforceGrounding, HandoffSchema, sanitizeModelBatch, UpdateConsensusInput } from "./handoff.ts";
import type { ConsensusUpdate, Handoff, Topic } from "./handoff.ts";
import { patchBatchJsonSchema, ToolPatchBatch } from "../ui/schema.ts";
import type { PatchBatch, Prototype } from "../ui/schema.ts";
import { findNode, fromToolBatch } from "../ui/tree.ts";
import { tickAgreement } from "../consensus/doc.ts";
import type { ConsensusDoc, Decision } from "../consensus/doc.ts";
import { buildComparisonView } from "../session/runtime.ts";
import type { Log, SessionRuntime } from "../session/runtime.ts";
import type { BuildTask, StageEvent } from "../stage/channel.ts";
import type { Store, StoredEvent } from "../store.ts";

export const RUN_FLOOR_MS = 3_000;
export const TICK_MS = 1_000;
export const PLEASED_MS = 2_000;
export const TASK_DONE_MS = 3_000;
const TASK_MAX = 40;
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

// What a topic shows in the to-do list: its own short task line, else its title.
export function taskText(t: Topic): string {
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
};

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
        inFlight: false, pending: null, pendingTaskIds: [], tasks: [], taskSeq: 0, pendingSince: null, bypassFloor: false, lastRunAt: null, timer: null, tick: null,
      };
      sessions.set(sessionId, st);
    }
    return st;
  };

  // Sets a decision's existing nodes to one status in one batch, skipping ids that no longer
  // exist. The only code path that marks nodes agreed: model batches are sanitised to draft.
  function flipNodes(sessionId: string, rt: SessionRuntime, d: Decision, status: "agreed" | "draft") {
    const proto = view(rt).proto;
    const ids = [...new Set(d.affects)].filter((id) => findNode(proto, id));
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

  function ensureTick(sessionId: string, st: SessionState) {
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

  function tick(sessionId: string, st: SessionState) {
    try {
      const rt = runtime(sessionId);
      const { doc, promoted } = tickAgreement(view(rt).doc, clock());
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
  // Returns whether the pick was acted on.
  function resolveChoice(sessionId: string, groundingIds: number[], choice: { conflictId: string; winner: "A" | "B" | "C" }): boolean {
    try {
      if (groundingFor(sessionId, groundingIds).speakers.size === 0) {
        log("build.resolve_ungrounded", { session_id: sessionId, conflict_id: choice.conflictId, grounding: groundingIds.length });
        return false;
      }
      const rt = runtime(sessionId);
      const before = view(rt).doc;
      const conflict = before.conflicts.find((c) => c.id === choice.conflictId);
      const r = rt.resolveComparison(choice.conflictId, choice.winner);
      if (!r.ok) {
        log("build.resolve_failed", { session_id: sessionId, conflict_id: choice.conflictId });
        return false;
      }
      if (conflict?.status !== "open") return true;
      const variant = conflict.variants.find((v) => v.label === choice.winner);
      const after = view(rt).doc;
      const decision = after.decisions.find((d) => !before.decisions.some((b) => b.id === d.id));
      if (!variant || !decision) return true;
      // A winner batch that did not apply changed nothing, so it marks nothing agreed.
      const proto = view(rt).proto;
      const touched = r.applied ? touchedIds(variant.batch).filter((id) => findNode(proto, id)) : [];
      const affects = [...new Set([...decision.affects, ...touched])];
      rt.setDoc({ ...after, decisions: after.decisions.map((d) => (d.id === decision.id ? { ...d, affects } : d)) });
      promote(sessionId, rt, [decision.id], "conflict");
      return true;
    } catch (err) {
      log("build.resolve_failed", { session_id: sessionId, conflict_id: choice.conflictId, error: errorName(err) });
      return false;
    }
  }

  function schedule(sessionId: string, st: SessionState) {
    if (st.inFlight || !st.pending) return;
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
      log("build.tasks_failed", { session_id: sessionId, error: errorName(err) });
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

  // apply_patches calls were applied while streaming; their counts arrive in `streamed`.
  function applyResult(
    sessionId: string, rt: SessionRuntime, result: RunToolsResult, speakers: Set<string>,
    streamed: { applied: number; rejected: number },
  ) {
    const counts = { patches_applied: streamed.applied, patches_rejected: streamed.rejected, consensus_invalid: 0, ops: 0, grounding_dropped: 0, promoted: 0, reopened: 0, conflicts: 0 };
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
      for (const id of addedConflicts) {
        const conflict = doc.conflicts.find((c) => c.id === id)!;
        const comparison = buildComparisonView(view(rt).proto, conflict);
        if (comparison) {
          rt.showComparison(comparison);
          counts.conflicts++;
        } else {
          log("build.comparison_skipped", { session_id: sessionId, conflict_id: id });
        }
      }
    }
    return counts;
  }

  async function run(sessionId: string, st: SessionState) {
    const h = st.pending!;
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
    const streamed = { applied: 0, rejected: 0 };
    let opsApplied = 0;
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

      // Each patch batch is applied as soon as its block closes, so it shows while Opus keeps writing.
      // Never throws: a throw would reject runTools and lose the cost row for a billed call.
      let firstPatchMs: number | null = null;
      let lastPatchMs: number | null = null;
      const onToolCall = (call: ToolCall) => {
        if (call.name !== "apply_patches") return;
        try {
          const parsed = ToolPatchBatch.safeParse(call.input);
          if (!parsed.success) {
            streamed.rejected++;
            log("build.batch_rejected", { session_id: sessionId, reason: "invalid_input" });
            return;
          }
          const r = live.applyBatch(sanitizeModelBatch(fromToolBatch(parsed.data), view(live).doc));
          if (!r.ok) {
            streamed.rejected++;
            log("build.batch_rejected", { session_id: sessionId, reason: "does_not_apply", ops: parsed.data.ops.length });
            return;
          }
          streamed.applied++;
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
          log("build.stream_apply_failed", { session_id: sessionId, error: errorName(err) });
        }
      };

      stage = "model";
      const result = await st.port.runTools({
        loop: "build", system: SYSTEM, tools: TOOLS, effort: "low", onToolInputDelta, onToolCall,
        messages: [{ role: "user", content: userTurn(h, grounding, doc, proto) }],
      });
      stage = "apply";
      const base = {
        session_id: sessionId, stop_reason: result.stopReason, tool_calls: result.toolCalls.length,
        dropped: result.dropped, ms: Math.round(result.ms), topics: h.topics.length, grounding: grounding.length,
        wait_ms: waitMs, first_patch_ms: firstPatchMs, last_patch_ms: lastPatchMs,
      };
      // A refusal or no usable call leaves the doc as it is; batches already streamed stay on screen.
      if (result.stopReason === "refusal" || result.toolCalls.length === 0) {
        log("build.run", { ...base, patches_applied: streamed.applied, patches_rejected: streamed.rejected });
      }
      else {
        const counts = applyResult(sessionId, live, result, speakers, streamed);
        opsApplied = counts.ops;
        log("build.run", { ...base, ...counts });
      }
    } catch (err) {
      log("build.run_failed", {
        session_id: sessionId, stage, error: errorName(err),
        status: (err as { status?: unknown } | null)?.status ?? null,
      });
    } finally {
      st.inFlight = false;
      try {
        if (rt && region) rt.pendingRegion(null);
        rt?.updateMoodInputs({ buildInFlight: false, buildStreaming: false });
      } catch (err) {
        log("build.cleanup_failed", { session_id: sessionId, error: errorName(err) });
      }
      finishTasks(sessionId, st, taskIds, streamed.applied > 0 || opsApplied > 0);
      ensureTick(sessionId, st);
      schedule(sessionId, st);
    }
  }

  return {
    handoff(sessionId: string, input: Handoff): void {
      const parsed = HandoffSchema.safeParse(input);
      if (!parsed.success) {
        log("build.handoff_invalid", { session_id: sessionId, issues: parsed.error.issues.length });
        return;
      }
      const st = state(sessionId);
      log("build.handoff", { session_id: sessionId, topics: parsed.data.topics.length, grounding: parsed.data.groundingIds.length });
      // A pick that was not acted on is removed, so the model never sees it as done.
      let resolved = false;
      const topics = parsed.data.topics.map((t) => {
        if (!t.resolvedChoice) return t;
        if (resolveChoice(sessionId, parsed.data.groundingIds, t.resolvedChoice)) {
          resolved = true;
          return t;
        }
        const { resolvedChoice: _dropped, ...rest } = t;
        return rest;
      });
      const h: Handoff = { ...parsed.data, topics };
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
    },

    idle(sessionId: string): boolean {
      const st = sessions.get(sessionId);
      return !st || (!st.inFlight && st.pending === null && st.timer === null);
    },
  };
}
