// The api's replies, as the web app reads them (plan: "Talking to the api"). A temporary copy of the shapes in
// apps/api/src/routes/schemas.ts until they move to @builder/contracts (WC1); SessionLimits already lives there.
// Tolerant on purpose: unknown fields are ignored and `status` is any string (shown as "Unknown" if new), so a field or
// status the api adds later never breaks the page. Contract changes are additive (ADR 0004).
import { SessionLimits } from "@builder/contracts";
import { z } from "zod";

export const SessionView = z.object({
  id: z.string(),
  meetingUrl: z.string(),
  status: z.string(),
  errorCode: z.string().optional(),
  // The stage's control link (plan: "Stage link"): never logged, never stored.
  stageUrl: z.string().optional(),
  limits: SessionLimits,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionView = z.infer<typeof SessionView>;

export const MeResponse = z.object({ userId: z.string(), orgId: z.string(), role: z.string() });
export type MeResponse = z.infer<typeof MeResponse>;

export const SessionList = z.object({ sessions: z.array(SessionView) });
export const SessionResponse = z.object({ session: SessionView });
export const CreateSessionResponse = z.object({ session: SessionView, reused: z.boolean() });
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

// Every error the api sends: `{ error: { code, message } }`, and for a failed start, the session as saved.
export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
  session: SessionView.optional(),
});
