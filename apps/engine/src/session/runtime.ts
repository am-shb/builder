// Per-session runtime: owns the prototype, consensus doc, mood and captions,
// persists them, and pushes every change to the stage over the channel.
// The runtime in memory is what the session runs on. Saving to the database happens in the background, one
// write at a time per session and in order, so the last write is always the latest state.
import { applyBatch as applyPatchBatch, emptyPrototype, findNode, findParent, UNTITLED_APP } from "../ui/tree.ts";
import type { Prototype, PatchBatch, Interaction } from "../ui/schema.ts";
import { emptyDoc, resolveConflict } from "../consensus/doc.ts";
import type { Conflict, ConsensusDoc } from "../consensus/doc.ts";
import type { Store } from "../store.ts";
import type { BuildTask, ComparisonView, StageEvent, StageSink } from "../stage/channel.ts";
import { deriveMood, NEUTRAL_MOOD_INPUTS } from "./mood.ts";
import type { Mood, MoodInputs } from "./mood.ts";
import { initialUiState, reduceInteraction } from "../../public/renderer/interact.js";
import { errorCode } from "../error-code.ts";

/** The stage's interaction state, mirrored here: screen, toggles, open, lists, values (keyed by node id). */
export type UiState = {
  screen: string;
  toggles: Record<string, boolean>;
  open: Record<string, boolean>;
  lists: Record<string, string[]>;
  values: Record<string, string>;
};

export type Log = (msg: string, fields?: Record<string, unknown>) => void;

export type SessionRuntime = ReturnType<typeof makeRuntime>;

/**
 * Finds a session's runtime. `load` starts it from the consensus saved in the database (after a restart,
 * say) and must come first wherever a session can be met for the first time: an event, the stage, a resume.
 * Calling the lookup itself for a session not loaded yet starts it empty, as for a brand-new session.
 */
export type RuntimeLookup = ((sessionId: string) => SessionRuntime) & {
  load?: (sessionId: string) => Promise<SessionRuntime>;
  // Resolves once every session's changes so far are saved (or their failures logged). A shutdown waits for it.
  flush?: () => Promise<void>;
};


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

/**
 * The comparison to show: the first open conflict, in the order they were raised, that has one.
 * Conflicts open at the same time are shown one after another (known issue M1).
 */
export function nextComparison(proto: Prototype, doc: ConsensusDoc): ComparisonView | null {
  for (const c of doc.conflicts) {
    if (c.status !== "open") continue;
    const view = buildComparisonView(proto, c);
    if (view) return view;
  }
  return null;
}

/**
 * Messages the stage sends up its WebSocket: `{ type: "ui_screen", screen }`, and `{ type: "barge_in" }`
 * (a person started talking over Builder), which calls `onBargeIn` so the caller can stop the speech.
 */
export function handleStageMessage(
  runtime: (sessionId: string) => SessionRuntime, sessionId: string, msg: unknown, onBargeIn?: (sessionId: string) => void,
) {
  const m = msg as { type?: unknown; screen?: unknown } | null;
  if (m && typeof m === "object" && m.type === "barge_in") onBargeIn?.(sessionId);
  if (m && typeof m === "object" && m.type === "ui_screen" && typeof m.screen === "string") runtime(sessionId).setUiScreen(m.screen);
}

type Saved = { doc: ConsensusDoc; proto: Prototype } | undefined;

export function createRuntime(deps: { store: Pick<Store, "getConsensus" | "saveConsensus">; channel: StageSink; clock?: () => number; log?: Log }) {
  const clock = deps.clock ?? Date.now;
  const log: Log = deps.log ?? (() => {});
  const runtimes = new Map<string, SessionRuntime>();
  const loading = new Map<string, Promise<SessionRuntime>>();
  const make = (sessionId: string, saved: Saved) => {
    let rt = runtimes.get(sessionId);
    if (!rt) {
      rt = makeRuntime(sessionId, saved, deps.store, deps.channel, clock, log);
      runtimes.set(sessionId, rt);
    }
    return rt;
  };
  const lookup = (sessionId: string): SessionRuntime => make(sessionId, undefined);
  // Concurrent loads of one session share a read, and a runtime that exists already is kept.
  lookup.load = (sessionId: string): Promise<SessionRuntime> => {
    const rt = runtimes.get(sessionId);
    if (rt) return Promise.resolve(rt);
    let pending = loading.get(sessionId);
    if (!pending) {
      pending = deps.store.getConsensus(sessionId)
        .then((saved) => make(sessionId, saved))
        .finally(() => loading.delete(sessionId));
      loading.set(sessionId, pending);
    }
    return pending;
  };
  lookup.flush = async (): Promise<void> => {
    await Promise.all([...runtimes.values()].map((rt) => rt.saved()));
  };
  return lookup;
}

function makeRuntime(sessionId: string, saved: Saved, store: Pick<Store, "saveConsensus">, channel: StageSink, clock: () => number, log: Log) {
  let proto: Prototype = saved?.proto ?? emptyPrototype(UNTITLED_APP);
  let doc: ConsensusDoc = saved?.doc ?? emptyDoc();
  // After a restart the room still sees the comparison it was choosing from (known issue M2).
  let comparison: ComparisonView | null = nextComparison(proto, doc);
  let moodInputs: MoodInputs = { ...NEUTRAL_MOOD_INPUTS };
  // What the room sees. Starts at the prototype's screen, then follows the stage's own reports
  // and the commands run here.
  let uiState: UiState = initialUiState(proto);
  let tasks: BuildTask[] = [];
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
  // Writes queue behind each other with the state as it was when asked, so they land in order. A failed
  // write is logged by name and doesn't stop the session; the next change writes the whole state again.
  let writes: Promise<void> = Promise.resolve();
  const persist = () => {
    const d = doc, p = proto;
    writes = writes.then(() => store.saveConsensus(sessionId, d, p))
      .catch((err) => log("runtime.persist_failed", { session_id: sessionId, error: errorCode(err) }));
  };

  return {
    // Resolves once every change made so far is saved (or its failure logged).
    saved(): Promise<void> {
      return writes;
    },

    snapshot(): StageEvent {
      return {
        type: "snapshot", proto, uiScreen: uiState.screen, doc,
        mood: deriveMood(moodInputs, clock()), comparison, tasks,
      };
    },

    setTasks(next: BuildTask[]) {
      tasks = next;
      send({ type: "tasks", tasks });
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

    // Tells the stage someone is talking. Only the flags go out, never who or what (known issue I7):
    // the stage token reaches the bot, and the stage shows no transcript.
    caption(c: { partial: boolean; isAgent: boolean }) {
      send({ type: "caption", caption: { partial: c.partial, isAgent: c.isAgent } });
    },

    pendingRegion(parentId: string | null) {
      send({ type: "pending_region", parentId });
    },

    uiState(): UiState {
      return uiState;
    },

    // The screen the stage reports it is showing. Unknown screens are ignored.
    setUiScreen(screen: string) {
      if (findNode(proto, screen)?.type !== "Screen" || screen === uiState.screen) return;
      uiState = { ...uiState, screen };
    },

    command(nodeId: string, interaction: Interaction) {
      uiState = reduceInteraction(uiState, interaction, proto);
      send({ type: "command", nodeId, interaction });
    },

    showComparison(view: ComparisonView | null) {
      comparison = view;
      send({ type: "comparison", view });
    },

    // A voice command asked to see one option of the comparison on screen ("show option B").
    // Returns false, and sends nothing, when no comparison with that option is shown.
    focusOption(label: string): boolean {
      if (!comparison?.variants.some((v) => v.label === label)) return false;
      send({ type: "focus_option", conflictId: comparison.conflictId, label });
      return true;
    },

    // Applies the winning variant's batch to the main prototype and resolves the
    // conflict in the doc. An unappliable batch still resolves the doc; `applied`
    // says whether the winner's batch landed on the prototype in this call. A conflict
    // already resolved is settled: nothing is applied, changed or sent again.
    resolveComparison(conflictId: string, winner: "A" | "B" | "C", pickers: string[] = []): { ok: boolean; applied?: boolean; error?: string } {
      const conflict = doc.conflicts.find((c) => c.id === conflictId);
      const variant = conflict?.variants.find((v) => v.label === winner);
      if (!conflict || !variant) {
        log("runtime.resolve_unknown", { session_id: sessionId, conflict_id: conflictId, winner });
        return { ok: false, error: `no conflict ${conflictId} with variant ${winner}` };
      }
      if (conflict.status === "resolved") return { ok: true, applied: false };

      const r = applyPatchBatch(proto, variant.batch);
      if (!r.ok) log("runtime.winner_batch_rejected", { session_id: sessionId, conflict_id: conflictId, winner });
      doc = resolveConflict(doc, conflictId, winner, clock(), pickers).doc;
      if (r.ok) proto = r.proto;
      // Only this conflict's comparison closes (the stage plays it out on "resolve"); then the next
      // open conflict, if any, takes the screen. Another conflict's comparison stays (known issue M1).
      const shown = comparison;
      if (!shown || shown.conflictId === conflictId) comparison = nextComparison(proto, doc);
      persist();
      send({ type: "resolve", conflictId, winner });
      if (r.ok) send({ type: "patch", proto, changes: r.changes });
      send({ type: "doc", doc });
      if (comparison && comparison !== shown) send({ type: "comparison", view: comparison });
      return { ok: true, applied: r.ok };
    },
  };
}
