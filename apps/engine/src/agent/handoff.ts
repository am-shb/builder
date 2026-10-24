// What crosses into and out of the build loop: the hand-off the conversation loop
// sends, the consensus ops the build model emits, the grounding rule that keeps
// unsupported attributions out, and the pure application of those ops to the doc.
import { z } from "zod";
import { ToolPatchBatch } from "../ui/schema.ts";
import type { PatchBatch, PatchOp, Prototype, ThemeSlotName, UiNode } from "../ui/schema.ts";
import { findNode, fromToolBatch } from "../ui/tree.ts";
import { touchedNodeIds } from "../ui/touched.ts";
import { THEME_SLOTS, themeValues } from "../../public/renderer/theme.js";
import { markPending, Phase, recordObjection, recordSupport } from "../consensus/doc.ts";
import type { ConsensusDoc, Conflict } from "../consensus/doc.ts";

const VariantLabel = z.enum(["A", "B", "C"]);

export const Proposal = z.strictObject({
  text: z.string(),
  proposedBy: z.string(),
  supporters: z.array(z.string()),
  objectors: z.array(z.string()),
});
export type Proposal = z.infer<typeof Proposal>;

export const Topic = z.strictObject({
  title: z.string(),
  task: z.string().optional(),
  screenHint: z.string().optional(),
  proposals: z.array(Proposal),
  questionsRaised: z.array(z.string()),
  resolvedChoice: z.strictObject({ conflictId: z.string(), winner: VariantLabel }).optional(),
});

// groundingIds are events.id values of the utterances the hand-off summarises.
export const HandoffSchema = z.strictObject({
  topics: z.array(Topic),
  mood: z.enum(["converging", "stuck", "exploring"]),
  requestedView: z.string().optional(),
  groundingIds: z.array(z.number().int()),
});
export type Handoff = z.infer<typeof HandoffSchema>;

// The update_build tool's local validator. A live probe (scripts/probe-handoff.ts) saw Haiku put
// requestedView on a topic when the room asked to see a screen. It belongs to the hand-off: unless
// the hand-off has its own, the last topic's copy moves up (the latest request wins, as when
// hand-offs merge). The topics lose theirs, and a topic whose view was not kept gets it as its
// screenHint when it has none, so no request is silently lost. The wire schema stays HandoffSchema.
export const HandoffToolInput = z.preprocess(repairHandoff, HandoffSchema);

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function repairHandoff(v: unknown): unknown {
  return hoistRequestedView(normalizeResolvedChoices(v));
}

function normalizeResolvedChoices(v: unknown): unknown {
  if (!isRecord(v) || !Array.isArray(v.topics) || !v.topics.some((t) => isRecord(t) && t.resolvedChoice !== undefined)) return v;
  return { ...v, topics: v.topics.map((t) => (isRecord(t) && t.resolvedChoice !== undefined ? { ...t, resolvedChoice: normalizeResolvedChoice(t.resolvedChoice) } : t)) };
}

// Models write the room's pick as a JSON string, a bare label ("B", "option b"), or an object with
// `label` for `winner` or no conflict id (a production session lost a pick to this). A recognised
// shape becomes { conflictId, winner }, with conflictId "*" when only a label was given (the build
// loop reads that as the one open conflict). Anything else comes back unchanged and fails validation.
export function normalizeResolvedChoice(v: unknown): unknown {
  const label = (x: unknown) => {
    const m = typeof x === "string" ? /^\s*(?:option\s*)?([abc])\s*$/i.exec(x) : null;
    return m ? m[1].toUpperCase() : null;
  };
  if (typeof v === "string") {
    const bare = label(v);
    if (bare) return { conflictId: "*", winner: bare };
    if (!v.trimStart().startsWith("{")) return v;
    try {
      const parsed: unknown = JSON.parse(v);
      return isRecord(parsed) ? normalizeResolvedChoice(parsed) : v;
    } catch {
      return v;
    }
  }
  if (!isRecord(v)) return v;
  const winner = label(v.winner) ?? label(v.label);
  if (!winner) return v;
  return { conflictId: typeof v.conflictId === "string" && v.conflictId ? v.conflictId : "*", winner };
}

function hoistRequestedView(v: unknown): unknown {
  if (!isRecord(v) || !Array.isArray(v.topics) || !v.topics.some((t) => isRecord(t) && "requestedView" in t)) return v;
  let view = v.requestedView;
  if (view === undefined) {
    for (const t of v.topics) if (isRecord(t) && typeof t.requestedView === "string") view = t.requestedView;
  }
  const topics = v.topics.map((t) => {
    if (!isRecord(t) || !("requestedView" in t)) return t;
    const { requestedView, ...rest } = t;
    if (typeof requestedView !== "string" || requestedView === view || rest.screenHint !== undefined) return rest;
    return { ...rest, screenHint: requestedView };
  });
  return { ...v, topics, ...(view === undefined ? {} : { requestedView: view }) };
}

const ToolVariant = z.strictObject({
  label: VariantLabel,
  summary: z.string(),
  backers: z.array(z.string()),
  batch: ToolPatchBatch,
});

export const ConsensusUpdate = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add_decision"), id: z.string(), text: z.string(), proposedBy: z.string(), affects: z.array(z.string()) }),
  z.strictObject({ op: z.literal("support"), decisionId: z.string(), speaker: z.string() }),
  z.strictObject({ op: z.literal("object"), decisionId: z.string(), speaker: z.string() }),
  z.strictObject({ op: z.literal("mark_pending"), decisionId: z.string() }),
  z.strictObject({ op: z.literal("add_open_question"), text: z.string(), raisedBy: z.string().nullable() }),
  z.strictObject({ op: z.literal("engage_question"), id: z.string() }),
  z.strictObject({ op: z.literal("close_question"), id: z.string() }),
  z.strictObject({ op: z.literal("add_conflict"), id: z.string(), topic: z.string(), variants: z.array(ToolVariant).min(2).max(3) }),
  z.strictObject({ op: z.literal("set_phase"), phase: Phase }),
  z.strictObject({ op: z.literal("set_next_up"), items: z.array(z.string()).max(5) }),
  z.strictObject({
    op: z.literal("set_app"),
    name: z.string().optional(), purpose: z.string().optional(), users: z.string().optional(),
  }),
]);
export type ConsensusUpdate = z.infer<typeof ConsensusUpdate>;

export const UpdateConsensusInput = z.strictObject({ ops: z.array(ConsensusUpdate) });

/**
 * A batch's `by` is the on-screen credit ("Added: due date · Amir"), so like a proposer it must be
 * someone heard in the grounding lines; otherwise it is removed. `dropped` is 1 when it was.
 */
export function groundCredit(batch: ToolPatchBatch, groundingSpeakers: Set<string>): { batch: ToolPatchBatch; dropped: number } {
  if (batch.by === undefined || groundingSpeakers.has(batch.by)) return { batch, dropped: 0 };
  const { by: _by, ...rest } = batch;
  return { batch: rest, dropped: 1 };
}

/** Who stands behind a still-open decision, and the node ids it affects. */
export type PriorBacking = { names: string[]; affects: string[] };

/**
 * Only people heard in the grounding lines can propose, back or object. Drops support/object ops
 * and add_decision ops whose speaker is not among them, and strips ungrounded conflict backers
 * (backers become agreed_by when a conflict resolves) and variant credits. A conflict's variant backers
 * may also be people who proposed or backed a still-open decision in an earlier hand-off (grounded when
 * recorded) that affects nodes the variant itself touches (`prior`). `dropped` counts ops, backers and credits removed.
 */
export function enforceGrounding(ops: ConsensusUpdate[], groundingSpeakers: Set<string>, prior: PriorBacking[] = [], screenIds: Set<string> = new Set()): { ops: ConsensusUpdate[]; dropped: number } {
  let dropped = 0;
  const kept: ConsensusUpdate[] = [];
  for (const op of ops) {
    const who = op.op === "support" || op.op === "object" ? op.speaker : op.op === "add_decision" ? op.proposedBy : null;
    if (who !== null && !groundingSpeakers.has(who)) {
      dropped++;
      continue;
    }
    if (op.op === "add_conflict") {
      const variants = op.variants.map((v) => {
        const touched = touchedNodeIds(v.batch, screenIds);
        const earlier = new Set(prior.filter((p) => p.affects.some((a) => touched.has(a))).flatMap((p) => p.names));
        const backers = v.backers.filter((b) => groundingSpeakers.has(b) || earlier.has(b));
        const credit = groundCredit(v.batch, groundingSpeakers);
        dropped += v.backers.length - backers.length + credit.dropped;
        return { ...v, backers, batch: credit.batch };
      });
      kept.push({ ...op, variants });
      continue;
    }
    kept.push(op);
  }
  return { ops: kept, dropped };
}

const asDraft = (n: UiNode): UiNode => ({ ...n, status: "draft", children: n.children.map(asDraft) });

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Whether removing `node` would take an agreed node off the prototype whose decision is not being reopened.
const holdsAgreed = (node: UiNode, reopened: Set<string>): boolean =>
  (node.status === "agreed" && !(node.decisionId !== undefined && reopened.has(node.decisionId))) ||
  node.children.some((c) => holdsAgreed(c, reopened));

/**
 * Only the build loop's promotion flip may mark nodes agreed. In a model-made batch, added nodes
 * are forced to draft, and an update to "agreed" loses that status (and its decisionId, unless the
 * decision really is agreed). An update left with nothing to change is dropped.
 *
 * With `current` (the model's own apply_patches batches, not conflict variants: the room's pick is
 * the decision for those), only a decision changes what was agreed (known issue I2). An update
 * never sets a status itself; one that changes an agreed node's props or decisionId sends that
 * node back to draft, and flipNodes makes it agreed again when a decision covering it is agreed.
 * An update that changes nothing is dropped. A remove that would take an agreed node off the
 * prototype is dropped, unless that node's decision is in `current.reopened` (reopened by this
 * run's consensus ops). Ops on nodes that don't exist are kept, so the batch still fails validation.
 *
 * Theme: set_theme is kept (applyBatch makes it a draft). With `current`, a slot it sets to the value
 * the slot already has is left out (and the op dropped when no slot is left), so a re-sent proposal
 * neither sends an agreed slot back to draft nor loses its `previous`. A theme_status agreed is always removed.
 * A theme_status revert (the model's drop_theme) is removed when a slot carrying that decision is
 * agreed and the decision is not in `current.reopened`; without `current` (conflict variants, which
 * never revert) every theme_status is removed.
 */
export function sanitizeModelBatch(
  batch: PatchBatch, doc: ConsensusDoc, current?: { proto: Prototype; reopened: Set<string> },
): PatchBatch {
  const agreed = new Set(doc.decisions.filter((d) => d.status === "agreed").map((d) => d.id));
  const ops: PatchOp[] = [];
  for (const op of batch.ops) {
    if (op.op === "add") {
      ops.push({ ...op, node: asDraft(op.node) });
    } else if (op.op === "update" && current) {
      const { status, decisionId, ...rest } = op;
      const next: Extract<PatchOp, { op: "update" }> =
        decisionId !== undefined && (status !== "agreed" || agreed.has(decisionId)) ? { ...rest, decisionId } : rest;
      const node = findNode(current.proto, op.id);
      if (!node) {
        ops.push(next);
        continue;
      }
      const changed = (next.decisionId !== undefined && next.decisionId !== node.decisionId) ||
        Object.entries(next.props ?? {}).some(([k, v]) => !sameValue(node.props[k], v));
      if (!changed) continue;
      ops.push(node.status === "agreed" ? { ...next, status: "draft" } : next);
    } else if (op.op === "update" && op.status === "agreed") {
      const { status: _status, decisionId, ...rest } = op;
      const next = decisionId !== undefined && agreed.has(decisionId) ? { ...rest, decisionId } : rest;
      if (next.props !== undefined || "decisionId" in next) ops.push(next);
    } else if (op.op === "set_theme" && current) {
      const shown = themeValues(current.proto.theme);
      const values: typeof op.values = {};
      for (const slot of THEME_SLOTS as ThemeSlotName[]) {
        const value = op.values[slot];
        if (value !== undefined && value !== shown[slot]) values[slot] = value;
      }
      if (Object.keys(values).length) ops.push({ ...op, values });
    } else if (op.op === "theme_status") {
      if (op.to !== "revert" || !current) continue;
      const holds = Object.values(current.proto.theme ?? {})
        .some((slot) => slot.decisionId === op.decisionId && slot.status === "agreed");
      if (!holds || current.reopened.has(op.decisionId)) ops.push(op);
    } else if (op.op === "remove" && current) {
      const node = findNode(current.proto, op.id);
      if (!node || !holdsAgreed(node, current.reopened)) ops.push(op);
    } else {
      ops.push(op);
    }
  }
  return { ...batch, ops };
}

function nextQuestionId(doc: ConsensusDoc): string {
  const taken = new Set(doc.openQuestions.map((q) => q.id));
  let n = doc.openQuestions.length + 1;
  while (taken.has(`q${n}`)) n++;
  return `q${n}`;
}

/**
 * Applies the model's ops to the doc in order. Pure. Ops naming an unknown decision or question
 * are no-ops; an add with an id already taken is ignored, as is a conflict with repeated labels.
 * A conflict's variant batches take the decision its resolution records (`d-<conflictId>`), even
 * when a batch names its own (a pick agrees only that id), and their updates are checked against
 * `proto`'s node types. `propsDropped` counts the props the
 * catalog dropped from the conflicts added.
 */
export function applyConsensusOps(
  input: ConsensusDoc, ops: ConsensusUpdate[], now: number, proto: Prototype,
): { doc: ConsensusDoc; addedConflicts: string[]; propsDropped: number; unoffered: number } {
  let doc = input;
  const addedConflicts: string[] = [];
  let propsDropped = 0;
  let unoffered = 0;
  for (const op of ops) {
    switch (op.op) {
      case "add_decision":
        if (doc.decisions.some((d) => d.id === op.id)) break;
        doc = { ...doc, decisions: [...doc.decisions, {
          id: op.id, text: op.text, status: "draft", proposedBy: op.proposedBy,
          agreedBy: [], affects: op.affects, rejectedOptions: [],
        }] };
        break;
      case "support": doc = recordSupport(doc, op.decisionId, op.speaker, now); break;
      case "object": doc = recordObjection(doc, op.decisionId, op.speaker, now); break;
      case "mark_pending": doc = markPending(doc, op.decisionId, now); break;
      case "add_open_question":
        doc = { ...doc, openQuestions: [...doc.openQuestions, { id: nextQuestionId(doc), text: op.text, raisedBy: op.raisedBy, since: now, lastEngagedAt: now }] };
        break;
      case "engage_question":
        doc = { ...doc, openQuestions: doc.openQuestions.map((q) => (q.id === op.id ? { ...q, lastEngagedAt: now } : q)) };
        break;
      case "close_question":
        doc = { ...doc, openQuestions: doc.openQuestions.filter((q) => q.id !== op.id) };
        break;
      case "add_conflict": {
        const labels = new Set(op.variants.map((v) => v.label));
        if (doc.conflicts.some((c) => c.id === op.id) || labels.size !== op.variants.length) break;
        const conflict: Conflict = {
          id: op.id, topic: op.topic, status: "open", openedAt: now,
          variants: op.variants.map((v) => {
            const { batch, dropped, unoffered: skipped } = fromToolBatch({ ...v.batch, decisionId: `d-${op.id}` }, {}, proto);
            propsDropped += dropped;
            unoffered += skipped;
            return { label: v.label, summary: v.summary, backers: v.backers, batch: sanitizeModelBatch(batch, doc) };
          }),
        };
        doc = { ...doc, conflicts: [...doc.conflicts, conflict] };
        addedConflicts.push(op.id);
        break;
      }
      case "set_phase": doc = { ...doc, phase: op.phase }; break;
      case "set_next_up": doc = { ...doc, nextUp: op.items }; break;
      case "set_app": {
        const app = { ...doc.app };
        if (op.name !== undefined) app.name = op.name;
        if (op.purpose !== undefined) app.purpose = op.purpose;
        if (op.users !== undefined) app.users = op.users;
        doc = { ...doc, app };
        break;
      }
    }
  }
  return { doc, addedConflicts, propsDropped, unoffered };
}
