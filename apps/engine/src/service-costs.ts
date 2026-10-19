// What a session costs outside model calls (src/agent/cost.ts has those): Builder's voice, and Recall's bot and
// transcription. Stored as service_costs (db/0004), one row per spoken line and one per Recall charge.

// OpenRouter's speech models are priced per input character (GET https://openrouter.ai/api/v1/models?
// output_modalities=speech, `pricing.prompt`, fetched 2026-10-19).
export const TTS_USD_PER_CHAR: Record<string, number> = {
  "elevenlabs/eleven-v4-turbo": 0.00002,
};

// Recall's pay-as-you-go rates (recall.ai/pricing and docs.recall.ai "Tracking and Calculating Usage", fetched
// 2026-10-19). A bot is billed per second from `joining_call` until it ends, waiting room included, and not at all
// when it ends in `fatal`. The variant adds to the base rate: $0.10 an hour for 4 cores, $1.00 for a GPU.
// Built-in transcription (recallai_streaming) is billed for the recording's length. Not counted here: storage of a
// recording kept past its 7 free days ($0.05 an hour of recording), which Recall bills later, not per session.
export const RECALL_BOT_USD_PER_HOUR = { web: 0.5, web_4_core: 0.6, web_gpu: 1.5 };
export const RECALL_TRANSCRIPT_USD_PER_HOUR = 0.15;

export type ServiceCostKind = "tts" | "recall_bot" | "recall_transcript";
// `id` makes a write idempotent: the utterance id for a line, `<session>:<kind>` for Recall's charges.
export type ServiceCost = { id: string; kind: ServiceCostKind; quantity: number; unit: "chars" | "seconds"; usd: number };

/** A line's TTS cost. Characters are code points, as a person would count them. */
export function ttsCost(text: string, usdPerChar: number): { chars: number; usd: number } {
  const chars = [...text].length;
  return { chars, usd: chars * usdPerChar };
}

type StatusChange = { code: string; created_at: string };

/**
 * Recall's charges for a bot that has ended, from its status history. The end is the last status: `done`, or
 * `call_ended` when the engine stops polling there, a few seconds before Recall's own `done`.
 */
export function recallCosts(sessionId: string, history: StatusChange[], variant: "web_4_core" | "web_gpu" | null): ServiceCost[] {
  const end = history.at(-1);
  if (!end || end.code === "fatal") return [];
  const at = (c: StatusChange | undefined) => (c ? Date.parse(c.created_at) : NaN);
  const seconds = (from: number) => Number.isFinite(from) ? Math.max(0, Math.round((at(end) - from) / 1000)) : 0;
  const rows: ServiceCost[] = [];
  const botSeconds = seconds(at(history.find((c) => c.code === "joining_call") ?? history[0]));
  const perHour = RECALL_BOT_USD_PER_HOUR[variant ?? "web"];
  if (botSeconds > 0) rows.push({ id: `${sessionId}:recall_bot`, kind: "recall_bot", quantity: botSeconds, unit: "seconds", usd: botSeconds * perHour / 3600 });
  const recordedSeconds = seconds(at(history.find((c) => c.code === "in_call_recording")));
  if (recordedSeconds > 0) {
    rows.push({
      id: `${sessionId}:recall_transcript`, kind: "recall_transcript", quantity: recordedSeconds, unit: "seconds",
      usd: recordedSeconds * RECALL_TRANSCRIPT_USD_PER_HOUR / 3600,
    });
  }
  return rows;
}
