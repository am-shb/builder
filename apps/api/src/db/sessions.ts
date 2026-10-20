// Sessions, always within one org: every query here filters by `org`, including reads by id, so another org's
// session looks the same as one that doesn't exist. Values go in as bound parameters only.
import { BoundQuery, RecordId } from "surrealdb";
import type { DateTime, Surreal } from "surrealdb";
import { orgRef } from "./orgs.ts";
import { MAX_LIST } from "./types.ts";
import { StartLimitError } from "./types.ts";
import type { ApiSessionStatus, CreateResult, NewSession, SessionRecord, StartLimit, StartLimits, StartResult } from "./types.ts";
import { DEFAULT_START_GUARDS } from "../start-guards.ts";

type Row = {
  id: RecordId<"session", string>;
  created_by: string;
  meeting_url: string;
  status: ApiSessionStatus;
  error_code?: string;
  stage_url?: string;
  max_usd: number;
  max_minutes: number;
  created_at: DateTime;
  updated_at: DateTime;
};

const FIELDS = "id, created_by, meeting_url, status, error_code, stage_url, max_usd, max_minutes, created_at, updated_at";

const sessionRef = (id: string) => new RecordId("session", id);

const toRecord = (r: Row): SessionRecord => ({
  id: r.id.id,
  createdBy: r.created_by,
  meetingUrl: r.meeting_url,
  status: r.status,
  errorCode: r.error_code ?? null,
  stageUrl: r.stage_url ?? null,
  limits: { maxUsd: r.max_usd, maxMinutes: r.max_minutes },
  createdAt: r.created_at.toDate().toISOString(),
  updatedAt: r.updated_at.toDate().toISOString(),
});

async function findActive(db: Surreal, org: RecordId, meetingUrl: string): Promise<SessionRecord | undefined> {
  const [rows] = await db.query<[Row[]]>(`SELECT ${FIELDS} FROM session WHERE org = $org AND active_meeting = $url LIMIT 1`,
    { org, url: meetingUrl }).retry().collect();
  return rows[0] && toRecord(rows[0]);
}

// When none are given (tests of other things): the defaults, which apply when the server's variables are unset.
const DEFAULT_LIMITS: StartLimits = {
  maxActive: DEFAULT_START_GUARDS.maxActivePerOrg,
  maxPerDay: DEFAULT_START_GUARDS.maxStartsPerOrgPerDay,
  maxActivePerUser: DEFAULT_START_GUARDS.maxActivePerUser,
  maxPerUserPerDay: DEFAULT_START_GUARDS.maxStartsPerUserPerDay,
  activeMarginMinutes: DEFAULT_START_GUARDS.activeMarginMinutes,
};

// Statuses that hold a place against the active limits until `active_until`: a bot is, or may be, in a meeting.
// start_unknown too: the engine didn't answer, so one may exist (reuse still skips it, so a new start can ask again).
const HOLDING = ["starting", "joining", "in_meeting", "start_unknown"];

/**
 * In one transaction:
 * 1. Write the org's row (created on its first request) and the person's row, with the time of this start. Every
 *    start writes both, so two starts at once for one org or one person conflict, and the retried one sees the first
 *    one's session in the counts below.
 * 2. Give the org's sessions from an older api their `active_until`, and rewrite those past it, so they stop counting
 *    as active (the stopgap until engine events, db/0002_start_guards.surql). Only those rows: rewriting a row moves
 *    its `updated_at`.
 * 3. Look for the org's active session for this meeting: if there is one, it's the answer (reused), with no limit
 *    checked, since nothing new starts.
 * 4. Otherwise check the limits: the org's sessions holding a place now and started in the last 24 hours, then the
 *    person's, across every org.
 * 5. Create the session, active until its time limit plus the margin.
 * Two requests for the same meeting at once conflict too, and the retried one finds the first one's row. The unique
 * index on (org, active_meeting) backs this up: if both still try to create, one fails on the index, and the active
 * session it finds after that is returned as reused.
 */
export async function createSessionUnlessActive(db: Surreal, orgId: string, s: NewSession, limits: StartLimits = DEFAULT_LIMITS): Promise<CreateResult> {
  const org = orgRef(orgId);
  const id = sessionRef(s.id);
  const starter = new RecordId("starter", s.createdBy);
  const content = {
    org, created_by: s.createdBy, meeting_url: s.meetingUrl, status: "starting",
    max_usd: s.limits.maxUsd, max_minutes: s.limits.maxMinutes,
  };
  try {
    // One query, several statements: the results come back one per statement, the last being the answer.
    const results = await db.transaction<unknown[]>([new BoundQuery(`
      UPSERT $org SET last_start_at = time::now();
      UPSERT $starter SET last_start_at = time::now();
      UPDATE session SET active_until = created_at + duration::from_secs(math::round((max_minutes + $margin) * 60))
        WHERE org = $org AND active_until = NONE AND status IN $holding;
      UPDATE session SET active_until = active_until WHERE org = $org AND active_meeting != NONE AND active_until <= time::now();
      LET $found = (SELECT VALUE id FROM session WHERE org = $org AND active_meeting = $url LIMIT 1)[0];
      LET $refused = IF $found != NONE { NONE }
        ELSE IF count(SELECT VALUE id FROM session WHERE org = $org AND status IN $holding AND active_until > time::now()) >= $maxActive { "active" }
        ELSE IF count(SELECT VALUE id FROM session WHERE org = $org AND created_at > time::now() - 1d) >= $maxPerDay { "daily" }
        ELSE IF count(SELECT VALUE id FROM session WHERE created_by = $user AND status IN $holding AND active_until > time::now()) >= $maxActivePerUser { "user_active" }
        ELSE IF count(SELECT VALUE id FROM session WHERE created_by = $user AND created_at > time::now() - 1d) >= $maxPerUserPerDay { "user_daily" }
        ELSE { NONE };
      IF $found = NONE AND $refused = NONE {
        CREATE $id CONTENT $content;
        UPDATE $id SET active_until = created_at + duration::from_secs(math::round((max_minutes + $margin) * 60));
      };
      { reused: $found != NONE, refused: $refused, row: IF $refused = NONE { (SELECT ${FIELDS} FROM ONLY ($found ?? $id)) } ELSE { NONE } };
    `, {
      org, starter, user: s.createdBy, url: s.meetingUrl, id, content, holding: HOLDING, margin: limits.activeMarginMinutes,
      maxActive: limits.maxActive, maxPerDay: limits.maxPerDay, maxActivePerUser: limits.maxActivePerUser, maxPerUserPerDay: limits.maxPerUserPerDay,
    })]);
    const out = results.at(-1) as { reused: boolean; refused: StartLimit | null | undefined; row: Row };
    if (out.refused) throw new StartLimitError(out.refused);
    return { session: toRecord(out.row), reused: out.reused };
  } catch (err) {
    if (err instanceof StartLimitError) throw err;
    const active = await findActive(db, org, s.meetingUrl);
    if (active) return { session: active, reused: true };
    throw err;
  }
}

function startFields(r: StartResult): { status: ApiSessionStatus; code?: string; stage?: string } {
  switch (r.kind) {
    case "ok": return { status: r.status, stage: r.stageUrl };
    case "rejected": return { status: "start_failed", code: r.errorCode };
    case "unknown": return { status: "start_unknown", code: r.errorCode };
  }
}

/** Only a `starting` session changes, so a late or repeated answer can't overwrite a newer status. */
export async function setSessionStart(db: Surreal, orgId: string, id: string, result: StartResult): Promise<SessionRecord | undefined> {
  if (!id) return undefined;
  const f = startFields(result);
  // An absent value is NONE, which clears the field.
  const [rows] = await db.query<[Row[]]>(
    `UPDATE $id SET status = $status, error_code = $code, stage_url = $stage WHERE org = $org AND status = "starting" RETURN ${FIELDS}`,
    { id: sessionRef(id), org: orgRef(orgId), status: f.status, code: f.code, stage: f.stage },
  ).retry().collect();
  return rows[0] && toRecord(rows[0]);
}

export async function getSession(db: Surreal, orgId: string, id: string): Promise<SessionRecord | undefined> {
  if (!id) return undefined;
  const [rows] = await db.query<[Row[]]>(`SELECT ${FIELDS} FROM $id WHERE org = $org`,
    { id: sessionRef(id), org: orgRef(orgId) }).retry().collect();
  return rows[0] && toRecord(rows[0]);
}

export async function listSessions(db: Surreal, orgId: string, limit: number = MAX_LIST): Promise<SessionRecord[]> {
  const n = Number.isFinite(limit) ? Math.min(MAX_LIST, Math.max(1, Math.floor(limit))) : MAX_LIST;
  const [rows] = await db.query<[Row[]]>(
    `SELECT ${FIELDS} FROM session WHERE org = $org ORDER BY created_at DESC, id DESC LIMIT $n`,
    { org: orgRef(orgId), n },
  ).retry().collect();
  return rows.map(toRecord);
}
