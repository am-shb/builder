// Consensus document: what the room has decided, what is open, and the pure
// functions that move a decision draft -> pending -> agreed.
import { z } from "zod";
import { PatchBatch } from "../ui/schema.ts";

export const NO_OBJECTION_MS = 30_000;

export const Phase = z.enum(["opening", "understand", "explore", "converge", "detail", "recap"]);
export type Phase = z.infer<typeof Phase>;

export const Decision = z.strictObject({
  id: z.string(),
  text: z.string(),
  status: z.enum(["draft", "pending", "agreed"]),
  proposedBy: z.string(),
  agreedBy: z.array(z.string()),
  pendingSince: z.number().optional(),
  decidedAt: z.number().optional(),
  affects: z.array(z.string()),
  rejectedOptions: z.array(z.string()),
});
export type Decision = z.infer<typeof Decision>;

export const OpenQuestion = z.strictObject({
  id: z.string(),
  text: z.string(),
  raisedBy: z.string().nullable(),
  since: z.number(),
  lastEngagedAt: z.number(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

const VariantLabel = z.enum(["A", "B", "C"]);

export const Variant = z.strictObject({
  label: VariantLabel,
  summary: z.string(),
  backers: z.array(z.string()),
  batch: PatchBatch,
});
export type Variant = z.infer<typeof Variant>;

export const Conflict = z.strictObject({
  id: z.string(),
  topic: z.string(),
  status: z.enum(["open", "resolved"]),
  openedAt: z.number(),
  variants: z.array(Variant).min(2).max(3),
  winner: VariantLabel.optional(),
});
export type Conflict = z.infer<typeof Conflict>;

export const ConsensusDocSchema = z.strictObject({
  phase: Phase,
  app: z.strictObject({
    name: z.string().optional(),
    purpose: z.string().optional(),
    users: z.string().optional(),
  }),
  decisions: z.array(Decision),
  openQuestions: z.array(OpenQuestion),
  conflicts: z.array(Conflict),
  nextUp: z.array(z.string()).max(5),
});
export type ConsensusDoc = z.infer<typeof ConsensusDocSchema>;

export function emptyDoc(): ConsensusDoc {
  return { phase: "opening", app: {}, decisions: [], openQuestions: [], conflicts: [], nextUp: [] };
}

function mapDecision(doc: ConsensusDoc, id: string, fn: (d: Decision) => Decision): ConsensusDoc {
  return { ...doc, decisions: doc.decisions.map((d) => (d.id === id ? fn(d) : d)) };
}

function agree(d: Decision, now: number, by?: string): Decision {
  const { pendingSince: _pendingSince, ...rest } = d;
  const agreedBy = by && !d.agreedBy.includes(by) ? [...d.agreedBy, by] : d.agreedBy;
  return { ...rest, status: "agreed", agreedBy, decidedAt: now };
}

export function markPending(doc: ConsensusDoc, id: string, now: number): ConsensusDoc {
  return mapDecision(doc, id, (d) => (d.status === "draft" ? { ...d, status: "pending", pendingSince: now } : d));
}

export function recordSupport(doc: ConsensusDoc, id: string, speaker: string | null, now: number): ConsensusDoc {
  if (!speaker || speaker === "Unknown") return doc;
  return mapDecision(doc, id, (d) => {
    if (d.status === "agreed" || speaker === d.proposedBy) return d;
    return d.status === "draft" ? { ...d, status: "pending", pendingSince: now } : agree(d, now, speaker);
  });
}

// An objection at any point sends the item back to draft.
export function recordObjection(doc: ConsensusDoc, id: string, _speaker: string | null, _now: number): ConsensusDoc {
  return mapDecision(doc, id, (d) => {
    if (d.status === "draft") return d;
    const { pendingSince: _pendingSince, decidedAt: _decidedAt, ...rest } = d;
    return { ...rest, status: "draft", agreedBy: [] };
  });
}

// Promotes pending decisions nobody objected to within NO_OBJECTION_MS. `ready` can hold back a due
// decision while an objection to it may still be on its way (the build loop's hand-offs in flight).
export function tickAgreement(
  doc: ConsensusDoc, now: number, ready: (d: Decision) => boolean = () => true,
): { doc: ConsensusDoc; promoted: string[] } {
  const promoted: string[] = [];
  const decisions = doc.decisions.map((d) => {
    if (d.status === "pending" && d.pendingSince !== undefined && now - d.pendingSince >= NO_OBJECTION_MS && ready(d)) {
      promoted.push(d.id);
      return agree(d, now);
    }
    return d;
  });
  return { doc: promoted.length ? { ...doc, decisions } : doc, promoted };
}

export function resolveConflict(
  doc: ConsensusDoc,
  conflictId: string,
  winner: "A" | "B" | "C",
  now: number,
): { doc: ConsensusDoc; decision: Decision } {
  const conflict = doc.conflicts.find((c) => c.id === conflictId);
  const won = conflict?.variants.find((v) => v.label === winner);
  if (!conflict || !won) throw new Error(`cannot resolve conflict ${conflictId} with variant ${winner}`);
  const id = `d-${conflictId}`;
  if (conflict.status === "resolved") {
    const existing = doc.decisions.find((d) => d.id === id);
    if (existing) return { doc, decision: existing };
  }
  const decision: Decision = {
    id,
    text: won.summary,
    status: "agreed",
    proposedBy: won.backers[0] ?? "Unknown",
    agreedBy: won.backers,
    decidedAt: now,
    affects: [],
    rejectedOptions: conflict.variants.filter((v) => v.label !== winner).map((v) => v.summary),
  };
  return {
    doc: {
      ...doc,
      decisions: [...doc.decisions, decision],
      conflicts: doc.conflicts.map((c) => (c.id === conflictId ? { ...c, status: "resolved", winner } : c)),
    },
    decision,
  };
}
