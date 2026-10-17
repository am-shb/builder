// What crosses into and out of the build loop: the hand-off the conversation loop
// sends, the consensus ops the build model emits, the grounding rule that keeps
// unsupported attributions out, and the pure application of those ops to the doc.
import { z } from "zod";
import { ToolPatchBatch } from "../ui/schema.ts";
import { fromToolBatch } from "../ui/tree.ts";
import { markPending, Phase, recordObjection, recordSupport } from "../consensus/doc.ts";
import type { ConsensusDoc, Conflict } from "../consensus/doc.ts";

const VariantLabel = z.enum(["A", "B", "C"]);

export const Proposal = z.strictObject({
  text: z.string(),
  proposedBy: z.string(),
  supporters: z.array(z.string()),
  objectors: z.array(z.string()),
});

export const Topic = z.strictObject({
  title: z.string(),
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
 * Only people heard in the grounding lines can propose, back or object. Drops support/object ops
 * and add_decision ops whose speaker is not among them, and strips ungrounded conflict backers
 * (backers become agreed_by when a conflict resolves). `dropped` counts ops and backers removed.
 */
export function enforceGrounding(ops: ConsensusUpdate[], groundingSpeakers: Set<string>): { ops: ConsensusUpdate[]; dropped: number } {
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
        const backers = v.backers.filter((b) => groundingSpeakers.has(b));
        dropped += v.backers.length - backers.length;
        return { ...v, backers };
      });
      kept.push({ ...op, variants });
      continue;
    }
    kept.push(op);
  }
  return { ops: kept, dropped };
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
 */
export function applyConsensusOps(input: ConsensusDoc, ops: ConsensusUpdate[], now: number): { doc: ConsensusDoc; addedConflicts: string[] } {
  let doc = input;
  const addedConflicts: string[] = [];
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
          variants: op.variants.map((v) => ({ label: v.label, summary: v.summary, backers: v.backers, batch: fromToolBatch(v.batch) })),
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
  return { doc, addedConflicts };
}
