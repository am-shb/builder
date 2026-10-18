// What the rest of the api sees of the database: plain objects with string ids and ISO times. No SurrealDB type
// (RecordId, DateTime) gets past src/db/, and nothing outside it imports `surrealdb`.
import type { SessionLimits, SessionStatus } from "../contracts.ts";

// The contract's statuses plus the api's own three (D6 in docs/plans/api-first-slice.md):
// - starting: the row is written and the engine hasn't answered yet
// - start_failed: the engine said no
// - start_unknown: no answer, so a bot may or may not exist. Shown as "check before retrying".
export type ApiSessionStatus = "starting" | "start_failed" | "start_unknown" | SessionStatus;

// A bot is, or may be about to be, in the meeting. A second start for the same org and meeting reuses it (D7).
export const ACTIVE_STATUSES: readonly ApiSessionStatus[] = ["starting", "joining", "in_meeting"];

export type SessionRecord = {
  id: string;
  createdBy: string;
  meetingUrl: string;
  status: ApiSessionStatus;
  errorCode: string | null;
  stageUrl: string | null;
  limits: SessionLimits;
  createdAt: string;
  updatedAt: string;
};

export type NewSession = {
  // The api's randomUUID(), sent to the engine as sessionId.
  id: string;
  // The Clerk user id.
  createdBy: string;
  meetingUrl: string;
  limits: SessionLimits;
};

/** `reused`: the org already had an active session for this meeting, returned instead of a new one. */
export type CreateResult = { session: SessionRecord; reused: boolean };

/** What the engine said when asked to start the session, as step 6 records it. */
export type StartResult =
  | { kind: "ok"; status: SessionStatus; stageUrl: string }
  | { kind: "rejected"; errorCode: string }
  | { kind: "unknown"; errorCode?: string };

export const MAX_LIST = 50;

/**
 * The only way into the database. Every function takes the org id first, from the verified token, and never
 * returns or changes another org's rows.
 */
export type Db = {
  /** Creates the org's row on its first request (D4). Safe to call on every request. */
  upsertOrg(orgId: string): Promise<void>;
  /** The org's active session for this meeting if there is one, otherwise a new `starting` one. Atomic. */
  createSessionUnlessActive(orgId: string, s: NewSession): Promise<CreateResult>;
  /** Records the engine's answer on a `starting` session. undefined if there's no such session in this org. */
  setSessionStart(orgId: string, id: string, result: StartResult): Promise<SessionRecord | undefined>;
  getSession(orgId: string, id: string): Promise<SessionRecord | undefined>;
  /** Newest first, at most MAX_LIST. */
  listSessions(orgId: string, limit?: number): Promise<SessionRecord[]>;
  close(): Promise<void>;
};
