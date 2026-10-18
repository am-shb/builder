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
  limits: SessionLimitsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SessionView = z.infer<typeof SessionView>;

/** GET /v1/sessions */
export const SessionList = z.strictObject({ sessions: z.array(SessionView) });
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
    limits: r.limits,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
