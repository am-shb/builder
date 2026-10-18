// Sessions, always within one org: every query here filters by `org`, including reads by id, so another org's
// session looks the same as one that doesn't exist. Values go in as bound parameters only.
import { BoundQuery, RecordId } from "surrealdb";
import type { DateTime, Surreal } from "surrealdb";
import { orgRef } from "./orgs.ts";
import { MAX_LIST } from "./types.ts";
import type { ApiSessionStatus, CreateResult, NewSession, SessionRecord, StartResult } from "./types.ts";

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

/**
 * In one transaction: make sure the org's row exists, look for its active session for this meeting, and create
 * the new one only if there's none. Two requests at once conflict, and the retried one finds the first one's row.
 * The unique index on (org, active_meeting) backs this up: if both still try to create, one fails on the index,
 * and the active session it finds after that is returned as reused.
 */
export async function createSessionUnlessActive(db: Surreal, orgId: string, s: NewSession): Promise<CreateResult> {
  const org = orgRef(orgId);
  const id = sessionRef(s.id);
  const content = {
    org, created_by: s.createdBy, meeting_url: s.meetingUrl, status: "starting",
    max_usd: s.limits.maxUsd, max_minutes: s.limits.maxMinutes,
  };
  try {
    // One query, four statements: the results come back one per statement, the last being the answer.
    const results = await db.transaction<unknown[]>([new BoundQuery(`
      UPSERT $org;
      LET $found = (SELECT VALUE id FROM session WHERE org = $org AND active_meeting = $url LIMIT 1)[0];
      IF $found = NONE { CREATE $id CONTENT $content };
      { reused: $found != NONE, row: (SELECT ${FIELDS} FROM ONLY ($found ?? $id)) };
    `, { org, url: s.meetingUrl, id, content })]);
    const out = results.at(-1) as { reused: boolean; row: Row };
    return { session: toRecord(out.row), reused: out.reused };
  } catch (err) {
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
