// Build loop: turns conversation hand-offs into consensus-document updates and
// prototype patches with Opus. One run in flight per session; hand-offs that arrive
// meanwhile merge into the next run, at most one run per 10 s unless a conflict was
// just resolved. Also promotes pending decisions after 30 s without objection.
// Logs ids, counts and durations only: never transcript text, prompts or model output.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { withCostRecording } from "./cost.ts";
import type { ModelPort, PortTool, RunToolsResult } from "./llm.ts";
import { applyConsensusOps, enforceGrounding, HandoffSchema, UpdateConsensusInput } from "./handoff.ts";
import type { ConsensusUpdate, Handoff } from "./handoff.ts";
import { patchBatchJsonSchema, ToolPatchBatch } from "../ui/schema.ts";
import type { PatchBatch, Prototype } from "../ui/schema.ts";
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

// Strict tool schemas reject numeric, length and item-count constraints, and want anyOf rather
// than oneOf. Those constraints stay enforced locally: every tool input is re-validated with zod.
const STRICT_UNSUPPORTED = new Set([
  "$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems",
]);

export function strictCompatible(schema: unknown): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (STRICT_UNSUPPORTED.has(k)) continue;
      out[k === "oneOf" ? "anyOf" : k] = clean(val);
    }
    return out;
  };
  return clean(schema) as Record<string, unknown>;
}

/** The JSON schema to send for a zod tool input under `strict: true`. */
export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictCompatible(z.toJSONSchema(schema, { target: "draft-7" }));
}

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

const label = (text: string) => {
  const full = `Agreed: ${text}`;
  return full.length <= LABEL_MAX ? full : `${full.slice(0, LABEL_MAX - 1)}…`;
};

export function createBuildLoop(deps: {
  port: ModelPort;
  runtime: (sessionId: string) => SessionRuntime;
  store: Store;
  clock: () => number;
  log?: Log;
  timers?: Timers;
}) {
  const { runtime, store, clock } = deps;
  const log: Log = deps.log ?? (() => {});
  const timers = deps.timers ?? realTimers;
  const sessions = new Map<string, SessionState>();

  const state = (sessionId: string): SessionState => {
    let st = sessions.get(sessionId);
    if (!st) {
      st = {
        port: withCostRecording(deps.port, { store, sessionId }),
        inFlight: false, pending: null, bypassFloor: false, lastRunAt: null, timer: null, tick: null,
      };
      sessions.set(sessionId, st);
    }
    return st;
  };

  // Flips a now-agreed decision's nodes in one batch, skipping ids that no longer exist.
  function flipNodes(sessionId: string, rt: SessionRuntime, d: Decision) {
    const proto = view(rt).proto;
    const ids = [...new Set(d.affects)].filter((id) => findNode(proto, id));
    if (!ids.length) return;
    const r = rt.applyBatch({ label: label(d.text), ops: ids.map((id) => ({ op: "update", id, status: "agreed", decisionId: d.id })) });
    if (!r.ok) log("build.flip_rejected", { session_id: sessionId, decision_id: d.id, ops: ids.length });
  }

  function promote(sessionId: string, rt: SessionRuntime, ids: string[], via: "support" | "timeout" | "conflict") {
    if (!ids.length) return;
    const doc = view(rt).doc;
    for (const id of ids) {
      const d = doc.decisions.find((x) => x.id === id);
      if (!d) continue;
      flipNodes(sessionId, rt, d);
      log("build.promoted", { session_id: sessionId, decision_id: id, via });
    }
    rt.updateMoodInputs({ pleasedUntil: clock() + PLEASED_MS });
  }

  function ensureTick(sessionId: string, st: SessionState) {
    const anyPending = view(runtime(sessionId)).doc.decisions.some((d) => d.status === "pending");
    if (anyPending && st.tick === null) {
      st.tick = timers.setInterval(() => tick(sessionId, st), TICK_MS);
    } else if (!anyPending && st.tick !== null) {
      timers.clearInterval(st.tick);
      st.tick = null;
    }
  }

  function tick(sessionId: string, st: SessionState) {
    const rt = runtime(sessionId);
    const { doc, promoted } = tickAgreement(view(rt).doc, clock());
    if (promoted.length) {
      rt.setDoc(doc);
      promote(sessionId, rt, promoted, "timeout");
    }
    ensureTick(sessionId, st);
  }

  // Applies the room's pick right away, then marks the winning variant's nodes agreed.
  function resolveChoice(sessionId: string, choice: { conflictId: string; winner: "A" | "B" | "C" }) {
    const rt = runtime(sessionId);
    const before = view(rt).doc;
    const conflict = before.conflicts.find((c) => c.id === choice.conflictId);
    const r = rt.resolveComparison(choice.conflictId, choice.winner);
    if (!r.ok) {
      log("build.resolve_failed", { session_id: sessionId, conflict_id: choice.conflictId });
      return;
    }
    if (conflict?.status !== "open") return;
    const variant = conflict.variants.find((v) => v.label === choice.winner);
    const after = view(rt).doc;
    const decision = after.decisions.find((d) => !before.decisions.some((b) => b.id === d.id));
    if (!variant || !decision) return;
    const proto = view(rt).proto;
    const affects = [...new Set([...decision.affects, ...touchedIds(variant.batch).filter((id) => findNode(proto, id))])];
    rt.setDoc({ ...after, decisions: after.decisions.map((d) => (d.id === decision.id ? { ...d, affects } : d)) });
    promote(sessionId, rt, [decision.id], "conflict");
  }

  function schedule(sessionId: string, st: SessionState) {
    if (st.inFlight || !st.pending) return;
    const wait = st.bypassFloor || st.lastRunAt === null ? 0 : Math.max(0, st.lastRunAt + RUN_FLOOR_MS - clock());
    if (wait === 0) {
      if (st.timer !== null) {
        timers.clearTimeout(st.timer);
        st.timer = null;
      }
      void run(sessionId, st);
    } else if (st.timer === null) {
      st.timer = timers.setTimeout(() => {
        st.timer = null;
        schedule(sessionId, st);
      }, wait);
    }
  }

  function applyResult(sessionId: string, rt: SessionRuntime, result: RunToolsResult, speakers: Set<string>) {
    const counts = { patches_applied: 0, patches_rejected: 0, consensus_invalid: 0, ops: 0, grounding_dropped: 0, promoted: 0, conflicts: 0 };
    const ops: ConsensusUpdate[] = [];
    // Patches first, so decisions and conflicts can reference the nodes they add.
    for (const call of result.toolCalls) {
      if (call.name !== "apply_patches") continue;
      const parsed = ToolPatchBatch.safeParse(call.input);
      if (!parsed.success) {
        counts.patches_rejected++;
        log("build.batch_rejected", { session_id: sessionId, reason: "invalid_input" });
        continue;
      }
      const r = rt.applyBatch(fromToolBatch(parsed.data));
      if (r.ok) counts.patches_applied++;
      else {
        counts.patches_rejected++;
        log("build.batch_rejected", { session_id: sessionId, reason: "does_not_apply", ops: parsed.data.ops.length });
      }
    }
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
      const promoted = doc.decisions
        .filter((d) => d.status === "agreed" && before.decisions.find((b) => b.id === d.id)?.status !== "agreed")
        .map((d) => d.id);
      counts.promoted = promoted.length;
      promote(sessionId, rt, promoted, "support");
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
    st.pending = null;
    st.bypassFloor = false;
    st.inFlight = true;
    st.lastRunAt = clock();
    const rt = runtime(sessionId);
    rt.updateMoodInputs({ buildInFlight: true, buildStreaming: false });

    const ids = new Set(h.groundingIds);
    const grounding = store.listEvents(sessionId).filter((e) => e.kind === "utterance" && ids.has(e.id));
    const speakers = new Set(grounding.map((e) => e.speaker).filter((s): s is string => !!s));
    const { doc, proto } = view(rt);

    // Streaming: "building" from the first input delta, and a placeholder where the
    // first added node is going, from the first complete add parentId.
    let streaming = false;
    let region = false;
    let buf = "";
    const parentRe = /"parentId"\s*:\s*"([a-z0-9][a-z0-9.-]{0,63})"/g;
    const onToolInputDelta = (tool: string, partial: string) => {
      if (!streaming) {
        streaming = true;
        rt.updateMoodInputs({ buildStreaming: true });
      }
      if (region || tool !== "apply_patches") return;
      buf += partial;
      // parentRe.lastIndex only moves past complete matches, so each byte is scanned about once.
      for (let m = parentRe.exec(buf); m; m = parentRe.exec(buf)) {
        if (/"op"\s*:\s*"add"/.test(buf.slice(buf.lastIndexOf("{", m.index), m.index))) {
          region = true;
          rt.pendingRegion(m[1]);
          return;
        }
      }
      parentRe.lastIndex = Math.max(0, buf.length - 100);
    };

    try {
      let result: RunToolsResult | null = null;
      try {
        result = await st.port.runTools({
          loop: "build", system: SYSTEM, tools: TOOLS, effort: "medium", onToolInputDelta,
          messages: [{ role: "user", content: userTurn(h, grounding, doc, proto) }],
        });
      } catch (err) {
        log("build.run_failed", {
          session_id: sessionId, error: err instanceof Error ? err.name : "unknown",
          status: (err as { status?: unknown } | null)?.status ?? null,
        });
      }
      if (result) {
        const base = {
          session_id: sessionId, stop_reason: result.stopReason, tool_calls: result.toolCalls.length,
          dropped: result.dropped, ms: Math.round(result.ms), topics: h.topics.length, grounding: grounding.length,
        };
        // A refusal or no usable call leaves the screen and the doc as they are.
        if (result.stopReason === "refusal" || result.toolCalls.length === 0) log("build.run", base);
        else log("build.run", { ...base, ...applyResult(sessionId, rt, result, speakers) });
      }
    } catch (err) {
      log("build.apply_failed", { session_id: sessionId, error: err instanceof Error ? err.name : "unknown" });
    } finally {
      if (region) rt.pendingRegion(null);
      rt.updateMoodInputs({ buildInFlight: false, buildStreaming: false });
      st.inFlight = false;
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
      const h = parsed.data;
      const st = state(sessionId);
      log("build.handoff", { session_id: sessionId, topics: h.topics.length, grounding: h.groundingIds.length });
      let resolved = false;
      for (const t of h.topics) {
        if (!t.resolvedChoice) continue;
        resolveChoice(sessionId, t.resolvedChoice);
        resolved = true;
      }
      st.pending = st.pending ? mergeHandoffs(st.pending, h) : h;
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
