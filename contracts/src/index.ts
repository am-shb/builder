// Shapes that cross the api and engine boundary (ADR 0008). Schemas and inferred types only.
// Parsing ignores unknown keys (zod's default), so adding a field is not a breaking change.
// Never put transcript text, prompts or model output in a contract.
import { z } from "zod";

const id = z.string().min(1);

export const SessionLimits = z.object({
  maxUsd: z.number().nonnegative(),
  maxMinutes: z.number().nonnegative(),
});
export type SessionLimits = z.infer<typeof SessionLimits>;

/** api -> engine: POST /internal/sessions */
export const StartSessionRequest = z.object({
  sessionId: id,
  orgId: id,
  meetingUrl: z.string().url(),
  limits: SessionLimits,
});
export type StartSessionRequest = z.infer<typeof StartSessionRequest>;

export const SessionStatus = z.enum(["joining", "in_meeting", "ended", "failed"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** engine -> api: the reply to POST /internal/sessions */
export const StartSessionResponse = z.object({
  sessionId: id,
  status: SessionStatus,
  stageUrl: z.string().url(),
});
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

const eventBase = {
  id,
  sessionId: id,
  orgId: id,
  at: z.iso.datetime(),
};

/**
 * The session's status now (A2). The engine sends only the latest one, and the api never moves a session backwards.
 * `id` is `<sessionId>:status:<status>`. `errorCode`, a plain snake_case code:
 * - failed: Recall's fatal sub-code (meeting_not_found, ...), or bot_failed
 * - ended: the engine's own limit (max_minutes, max_usd), or Recall's call_ended sub-code (bot_kicked_from_call, ...)
 */
export const SessionStatusEvent = z.object({
  ...eventBase,
  type: z.literal("session.status"),
  status: SessionStatus,
  errorCode: z.string().optional(),
});
export type SessionStatusEvent = z.infer<typeof SessionStatusEvent>;

/** Cumulative totals so far, so a retried or duplicated event is harmless. */
export const SessionUsageEvent = z.object({
  ...eventBase,
  type: z.literal("session.usage"),
  botMinutes: z.number().nonnegative(),
  modelUsd: z.number().nonnegative(),
  ttsChars: z.number().int().nonnegative(),
});
export type SessionUsageEvent = z.infer<typeof SessionUsageEvent>;

export const HandoffReadyEvent = z.object({
  ...eventBase,
  type: z.literal("handoff.ready"),
  handoffId: id,
  url: z.string().url(),
});
export type HandoffReadyEvent = z.infer<typeof HandoffReadyEvent>;

/** engine -> api: POST /internal/engine-events, one event per call. */
export const EngineEvent = z.discriminatedUnion("type", [SessionStatusEvent, SessionUsageEvent, HandoffReadyEvent]);
export type EngineEvent = z.infer<typeof EngineEvent>;

export type ParsedEngineEvent =
  | { kind: "event"; event: EngineEvent }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; error: z.ZodError };

/**
 * Receiver pattern: parse an event without throwing. An event type this version doesn't know comes back as
 * `unknown`, so the receiver can acknowledge and skip it. A known type with a bad shape comes back as `invalid`.
 */
export function parseEngineEvent(input: unknown): ParsedEngineEvent {
  const known = EngineEvent.options.map((o) => o.shape.type.value as string);
  const type = typeof input === "object" && input !== null ? (input as { type?: unknown }).type : undefined;
  if (typeof type === "string" && !known.includes(type)) return { kind: "unknown", type };
  const result = EngineEvent.safeParse(input);
  return result.success ? { kind: "event", event: result.data } : { kind: "invalid", error: result.error };
}
