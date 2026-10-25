// Shapes between the api and the web app (D2 in docs/plans/api-first-slice.md). They stay here until apps/web
// imports them, then move to contracts/ (C3). Strict: a field the web app shouldn't see can't slip in.
import { z } from "zod";
import { SessionLimitsSchema, SessionStatusSchema } from "../contracts.ts";
import type { SessionRecord } from "../db/index.ts";

// The contract's statuses plus the api's own three (D6).
export const ApiSessionStatus = z.enum(["starting", "start_failed", "start_unknown", ...SessionStatusSchema.options]);

export const SessionView = z.strictObject({
  id: z.string(),
  meetingUrl: z.string(),
  status: ApiSessionStatus,
  // Absent rather than null when there's nothing to say.
  errorCode: z.string().optional(),
  // Shown to members of the owning org (D8). Never logged.
  stageUrl: z.string().optional(),
  // The engine's handoff page, once the meeting has ended (ADR 0008). A read-only link for the org. Never logged.
  handoffUrl: z.string().optional(),
  limits: SessionLimitsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SessionView = z.infer<typeof SessionView>;

/**
 * GET /v1/sessions. Without the stage URL (a control link) or the handoff link: links with tokens are sent only for one
 * session (GET /v1/sessions/:id).
 */
export const SessionListItem = SessionView.omit({ stageUrl: true, handoffUrl: true });
export type SessionListItem = z.infer<typeof SessionListItem>;
export const SessionList = z.strictObject({ sessions: z.array(SessionListItem) });
export type SessionList = z.infer<typeof SessionList>;

/** GET /v1/sessions/:id */
export const SessionResponse = z.strictObject({ session: SessionView });
export type SessionResponse = z.infer<typeof SessionResponse>;

export function toSessionView(r: SessionRecord): SessionView {
  return {
    id: r.id,
    meetingUrl: r.meetingUrl,
    status: r.status,
    ...(r.errorCode !== null ? { errorCode: r.errorCode } : {}),
    ...(r.stageUrl !== null ? { stageUrl: r.stageUrl } : {}),
    ...(r.handoffUrl !== null ? { handoffUrl: r.handoffUrl } : {}),
    limits: r.limits,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toSessionListItem(r: SessionRecord): SessionListItem {
  const { stageUrl: _stageUrl, handoffUrl: _handoffUrl, ...item } = toSessionView(r);
  return item;
}

// The same hosts the engine accepts (MEETING_HOSTS in apps/engine/src/app.ts): Google Meet, Zoom and Teams.
const MEETING_HOSTS = /^(meet\.google\.com|([a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/i;

/** An https meeting link on a host the engine can join, normalized by URL parsing (so reuse matches it). */
export const MeetingUrl = z.string().trim().max(2000).transform((s, ctx) => {
  const u = URL.canParse(s) ? new URL(s) : null;
  if (!u || u.protocol !== "https:" || !MEETING_HOSTS.test(u.hostname) || u.username || u.password) {
    ctx.addIssue({ code: "custom", message: "Use an https Google Meet, Zoom or Teams link." });
    return z.NEVER;
  }
  return u.href;
});

/** POST /v1/sessions. Any other field, such as an org id, is ignored: the org comes from the token. */
export const CreateSessionBody = z.object({ meetingUrl: MeetingUrl });
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

/** POST /v1/sessions, 201 (started) or 200 (`reused`: the org's active session for this meeting). */
export const CreateSessionResponse = z.strictObject({ session: SessionView, reused: z.boolean() });
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

/** POST /v1/sessions, 502 engine_rejected or 504 engine_outcome_unknown: the error, and the session as saved. */
export const StartFailedResponse = z.strictObject({
  error: z.strictObject({ code: z.enum(["engine_rejected", "engine_outcome_unknown"]), message: z.string() }),
  session: SessionView,
});
export type StartFailedResponse = z.infer<typeof StartFailedResponse>;
