// Normalises Recall realtime endpoint payloads (v1.11) into the few fields the
// app uses. Parsing is defensive: unknown shapes yield null instead of throwing.

export type RealtimeEvent = {
  kind: "utterance" | "partial" | "join" | "leave" | "chat";
  botId: string | null;
  sessionId: string | null;
  speaker: string | null;
  text: string | null;
};

const KINDS: Record<string, RealtimeEvent["kind"]> = {
  "transcript.data": "utterance",
  "transcript.partial_data": "partial",
  "participant_events.join": "join",
  "participant_events.leave": "leave",
  "participant_events.chat_message": "chat",
};

export function parseRealtimeEvent(body: unknown): RealtimeEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as any;
  const kind = KINDS[b.event];
  if (!kind) return null;

  const inner = b.data?.data ?? {};
  const speaker = inner.participant?.name ?? null;
  let text: string | null = null;
  if (kind === "utterance" || kind === "partial") {
    const words = Array.isArray(inner.words) ? inner.words : [];
    text = words.map((w: any) => w?.text ?? "").join(" ").replace(/\s+/g, " ").trim() || null;
  } else if (kind === "chat") {
    text = inner.data?.text ?? null;
  }

  return {
    kind,
    botId: b.data?.bot?.id ?? null,
    sessionId: b.data?.bot?.metadata?.session_id ?? null,
    speaker,
    text,
  };
}
