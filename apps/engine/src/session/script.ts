// Script driver: plays a list of timed steps against a session runtime. Used
// for visual QA (local-only endpoint). Steps are validated before anything runs.
import { z } from "zod";
import { PatchBatch, Prototype } from "../ui/schema.ts";
import { ConsensusDocSchema } from "../consensus/doc.ts";
import type { SessionRuntime } from "./runtime.ts";
import { NEUTRAL_MOOD_INPUTS } from "./mood.ts";
import type { Mood, MoodInputs } from "./mood.ts";

const MoodName = z.enum(["listening", "thinking", "building", "speaking", "curious", "unsure", "pleased"]);
const Label = z.enum(["A", "B", "C"]);

const ComparisonViewSchema = z.strictObject({
  conflictId: z.string(),
  topic: z.string(),
  variants: z.array(z.strictObject({
    label: z.string(),
    summary: z.string(),
    backers: z.array(z.string()),
    proto: Prototype,
    focusIds: z.array(z.string()),
  })),
});

const Step = z.strictObject({
  wait: z.number().min(0).max(30_000).optional(),
  batch: PatchBatch.optional(),
  doc: ConsensusDocSchema.optional(),
  mood: MoodName.optional(),
  comparison: ComparisonViewSchema.nullable().optional(),
  tasks: z.array(z.strictObject({ id: z.string(), text: z.string(), state: z.enum(["now", "queued", "done"]) })).optional(),
  resolve: z.strictObject({ conflictId: z.string(), winner: Label }).optional(),
  // speaker and text are accepted for older scripts but never sent to the stage (known issue I7).
  caption: z.strictObject({ speaker: z.string().optional(), text: z.string().optional(), partial: z.boolean(), isAgent: z.boolean() }).optional(),
});

export const Script = z.strictObject({ steps: z.array(Step).max(500) });
export type Script = z.infer<typeof Script>;

const HOLD_MS = 60 * 60 * 1000;

// Scripted moods are forced by setting the inputs that derive them.
function inputsForMood(mood: Mood, now: number): Partial<MoodInputs> {
  switch (mood) {
    case "speaking": return { speaking: true };
    case "unsure": return { unsureUntil: now + HOLD_MS };
    case "building": return { buildInFlight: true, buildStreaming: true };
    case "thinking": return { buildInFlight: true };
    case "pleased": return { pleasedUntil: now + HOLD_MS };
    case "curious": return { lastSpeechWasQuestion: true };
    case "listening": return {};
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type StepResult = { index: number; ok: boolean; error?: string };

export async function runScript(rt: SessionRuntime, script: Script, clock: () => number = Date.now): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const [index, step] of script.steps.entries()) {
    if (step.wait) await sleep(step.wait);
    let r: { ok: boolean; error?: string } = { ok: true };
    if (step.batch) r = rt.applyBatch(step.batch);
    if (step.doc) rt.setDoc(step.doc);
    if (step.mood) {
      rt.updateMoodInputs({ ...NEUTRAL_MOOD_INPUTS, ...inputsForMood(step.mood, clock()) });
    }
    if (step.comparison !== undefined) rt.showComparison(step.comparison);
    if (step.tasks) rt.setTasks(step.tasks);
    if (step.resolve) r = rt.resolveComparison(step.resolve.conflictId, step.resolve.winner);
    if (step.caption) rt.caption({ partial: step.caption.partial, isAgent: step.caption.isAgent });
    results.push({ index, ...r });
  }
  return results;
}
