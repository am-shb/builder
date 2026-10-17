// Per-session runtime: owns the prototype, consensus doc, mood and captions,
// persists them, and pushes every change to the stage over the channel.
import { applyBatch as applyPatchBatch, emptyPrototype, findNode, findParent } from "../ui/tree.ts";
import type { Prototype, PatchBatch, Interaction } from "../ui/schema.ts";
import { emptyDoc, resolveConflict } from "../consensus/doc.ts";
import type { Conflict, ConsensusDoc } from "../consensus/doc.ts";
import type { Store } from "../store.ts";
import type { Caption, ComparisonView, StageEvent, StageSink } from "../stage/channel.ts";
import { deriveMood, NEUTRAL_MOOD_INPUTS } from "./mood.ts";
import type { Mood, MoodInputs } from "./mood.ts";

export type Log = (msg: string, fields?: Record<string, unknown>) => void;

const MAX_FINAL_CAPTIONS = 3;

export type SessionRuntime = ReturnType<typeof makeRuntime>;

/**
 * The side-by-side view of a conflict: each variant applied to the current prototype, with the
 * ids its changes touched (a removal focuses the parent it left). A variant whose batch does not
 * apply is dropped; with fewer than two left there is nothing to compare, so the result is null.
 */
export function buildComparisonView(proto: Prototype, conflict: Conflict): ComparisonView | null {
  const variants: ComparisonView["variants"] = [];
  for (const v of conflict.variants) {
    const r = applyPatchBatch(proto, v.batch);
    if (!r.ok) continue;
    const focusIds = new Set<string>();
    for (const c of r.changes) {
      if (c.kind === "screen") continue;
      const id = c.kind === "removed" ? findParent(proto.root, c.id)?.id : c.id;
      if (id && findNode(r.proto, id)) focusIds.add(id);
    }
    variants.push({ label: v.label, summary: v.summary, backers: v.backers, proto: r.proto, focusIds: [...focusIds] });
  }
  return variants.length >= 2 ? { conflictId: conflict.id, topic: conflict.topic, variants } : null;
}

export function createRuntime(deps: { store: Store; channel: StageSink; clock?: () => number; log?: Log }) {
  const clock = deps.clock ?? Date.now;
  const log: Log = deps.log ?? (() => {});
  const runtimes = new Map<string, SessionRuntime>();
  return (sessionId: string): SessionRuntime => {
    let rt = runtimes.get(sessionId);
    if (!rt) {
      rt = makeRuntime(sessionId, deps.store, deps.channel, clock, log);
      runtimes.set(sessionId, rt);
    }
    return rt;
  };
}

function makeRuntime(sessionId: string, store: Store, channel: StageSink, clock: () => number, log: Log) {
  const saved = store.getConsensus(sessionId);
  let proto: Prototype = saved?.proto ?? emptyPrototype("Untitled app");
  let doc: ConsensusDoc = saved?.doc ?? emptyDoc();
  let comparison: ComparisonView | null = null;
  let finals: Caption[] = [];
  let partial: Caption | null = null;
  let moodInputs: MoodInputs = { ...NEUTRAL_MOOD_INPUTS };
  let lastMood: Mood = deriveMood(moodInputs, clock());

  // Re-derive against the clock, push only on change, and wake up at the next
  // window boundary so expiries reach the stage without another input.
  let moodTimer: ReturnType<typeof setTimeout> | undefined;
  function refreshMood() {
    clearTimeout(moodTimer);
    const now = clock();
    const mood = deriveMood(moodInputs, now);
    if (mood !== lastMood) {
      lastMood = mood;
      send({ type: "mood", mood });
    }
    const upcoming = [moodInputs.unsureUntil, moodInputs.pleasedUntil, moodInputs.addressedUntil].filter((t) => t > now);
    if (upcoming.length) {
      moodTimer = setTimeout(refreshMood, Math.min(...upcoming) - now + 1);
      moodTimer.unref();
    }
  }

  const send = (ev: StageEvent) => channel.send(sessionId, ev);
  const persist = () => store.saveConsensus(sessionId, doc, proto);

  return {
    snapshot(): StageEvent {
      return {
        type: "snapshot", proto, uiScreen: proto.currentScreen, doc,
        captions: partial ? [...finals, partial] : [...finals],
        mood: deriveMood(moodInputs, clock()), comparison,
      };
    },

    applyBatch(batch: PatchBatch): { ok: boolean; error?: string } {
      const r = applyPatchBatch(proto, batch);
      if (!r.ok) {
        log("runtime.batch_rejected", { session_id: sessionId, ops: batch.ops.length });
        return { ok: false, error: r.error };
      }
      proto = r.proto;
      persist();
      send({ type: "patch", proto, changes: r.changes });
      return { ok: true };
    },

    setDoc(next: ConsensusDoc) {
      doc = next;
      persist();
      send({ type: "doc", doc });
    },

    updateMoodInputs(inputs: Partial<MoodInputs>) {
      moodInputs = { ...moodInputs, ...inputs };
      refreshMood();
    },

    // Keeps the last 3 final captions plus one in-progress partial.
    caption(c: Caption) {
      if (c.partial) partial = c;
      else {
        finals = [...finals, c].slice(-MAX_FINAL_CAPTIONS);
        partial = null;
      }
      send({ type: "caption", caption: c });
    },

    pendingRegion(parentId: string | null) {
      send({ type: "pending_region", parentId });
    },

    command(nodeId: string, interaction: Interaction) {
      send({ type: "command", nodeId, interaction });
    },

    showComparison(view: ComparisonView | null) {
      comparison = view;
      send({ type: "comparison", view });
    },

    // Applies the winning variant's batch to the main prototype and resolves the
    // conflict in the doc. An unappliable batch still resolves the doc.
    resolveComparison(conflictId: string, winner: "A" | "B" | "C"): { ok: boolean; error?: string } {
      const conflict = doc.conflicts.find((c) => c.id === conflictId);
      const variant = conflict?.variants.find((v) => v.label === winner);
      if (!conflict || !variant) {
        log("runtime.resolve_unknown", { session_id: sessionId, conflict_id: conflictId, winner });
        return { ok: false, error: `no conflict ${conflictId} with variant ${winner}` };
      }

      // An already-resolved conflict is not re-applied.
      let applied: Extract<ReturnType<typeof applyPatchBatch>, { ok: true }> | null = null;
      if (conflict.status !== "resolved") {
        const r = applyPatchBatch(proto, variant.batch);
        if (r.ok) applied = r;
        else log("runtime.winner_batch_rejected", { session_id: sessionId, conflict_id: conflictId, winner });
      }
      doc = resolveConflict(doc, conflictId, winner, clock()).doc;
      if (applied) proto = applied.proto;
      comparison = null;
      persist();
      send({ type: "resolve", conflictId, winner });
      if (applied) send({ type: "patch", proto, changes: applied.changes });
      send({ type: "doc", doc });
      return { ok: true };
    },
  };
}
