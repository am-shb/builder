// The session routes (steps 5 and 6 of docs/plans/api-first-slice.md): GET /v1/sessions, GET /v1/sessions/:id and
// POST /v1/sessions. Any role in the org may read and start a session. The org always comes from the verified token,
// never from the body, the query, a header or the path.
import { randomUUID } from "node:crypto";
import type { Authenticator } from "../auth/clerk.ts";
import { requireOrg } from "../auth/org.ts";
import type { SessionLimits } from "../contracts.ts";
import type { Db, SessionRecord, StartResult } from "../db/index.ts";
import type { EngineClient, StartOutcome } from "../engine/client.ts";
import { HttpError, readJson, sendJson } from "../http.ts";
import type { Log, Route } from "../router.ts";
import { createRateLimiter } from "../rate-limit.ts";
import { DEFAULT_START_GUARDS, type StartGuards } from "../start-guards.ts";
import { StartLimitError } from "../db/index.ts";
import { CreateSessionBody, toSessionListItem, toSessionView } from "./schemas.ts";
import type { CreateSessionResponse, SessionList, SessionResponse, StartFailedResponse } from "./schemas.ts";

// Session ids are the api's randomUUID()s. Anything else can't exist, so it's a 404 without a query.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Another org's session answers exactly like one that doesn't exist, so the id's existence isn't revealed.
const notFound = () => new HttpError(404, "not_found", "No such session.");

export function sessionReadRoutes(auth: Authenticator, db: Db | null): Route[] {
  const needDb = () => {
    if (!db) throw new HttpError(503, "db_unavailable", "The database isn't available on this server.");
    return db;
  };
  return [
    {
      method: "GET",
      path: "/v1/sessions",
      handler: async ({ req, res }) => {
        const { orgId } = requireOrg(await auth.authenticate(req));
        // The org's 50 newest. No paging for the hackathon; `limit` and a cursor can be added later. No stage URLs:
        // they're control links, sent only on a session's own read.
        const body: SessionList = { sessions: (await needDb().listSessions(orgId)).map(toSessionListItem) };
        sendJson(res, 200, body);
      },
    },
    {
      method: "GET",
      path: "/v1/sessions/:id",
      handler: async ({ req, res, params }) => {
        const { orgId } = requireOrg(await auth.authenticate(req));
        const d = needDb();
        if (!UUID.test(params.id)) throw notFound();
        const session = await d.getSession(orgId, params.id);
        if (!session) throw notFound();
        const body: SessionResponse = { session: toSessionView(session) };
        sendJson(res, 200, body);
      },
    },
  ];
}

export type SessionCreateDeps = {
  auth: Authenticator;
  db: Db | null;
  engine: EngineClient | null;
  // Per-session limits until billing exists (D5). null: not configured, so nothing can start.
  limits: SessionLimits | null;
  // Limits on starting sessions: per org (active at once, per day) and per user (per minute). Defaults if absent.
  guards?: StartGuards;
  log: Log;
  // For tests: the rate limiter's clock.
  now?: () => number;
};

// The engine's answer, as the session row records it.
function startResult(outcome: StartOutcome): StartResult {
  switch (outcome.kind) {
    case "ok": return { kind: "ok", status: outcome.response.status, stageUrl: outcome.response.stageUrl };
    case "rejected": return { kind: "rejected", errorCode: outcome.code };
    case "unknown": return { kind: "unknown", errorCode: outcome.reason };
  }
}

/**
 * POST /v1/sessions { meetingUrl }:
 * 0. At most START_RATE_LIMIT_PER_MINUTE requests per user per minute: 429 rate_limited, with Retry-After.
 * 1. The org's active session for this meeting, if there is one, comes back with 200 and `reused: true`. The engine
 *    isn't called, so a double-click never sends two bots (D7). A session past its time limit plus a margin no longer
 *    counts as active (a stopgap until engine events).
 * 1b. Otherwise, 429 active_limit_reached or daily_limit_reached when the org is at MAX_ACTIVE_SESSIONS_PER_ORG or
 *    MAX_STARTS_PER_ORG_PER_DAY. Checked in the same transaction that creates the session, so nothing is saved.
 * 2. Otherwise the session is saved as `starting` before the engine is called, so a bot is never sent for a session
 *    the api has no record of.
 * 3. The engine is called once, never retried: a retry can send a second paid bot (ADR 0010).
 *    - ok: 201 with the session, now joining (or whatever the engine said)
 *    - rejected: 502 engine_rejected, the session saved as start_failed with the engine's code
 *    - unknown (timeout, network, 5xx, bad reply): 504 engine_outcome_unknown, the session saved as start_unknown.
 *      A bot may exist, so the web app says "check before retrying".
 */
export function sessionCreateRoutes(deps: SessionCreateDeps): Route[] {
  const guards = deps.guards ?? DEFAULT_START_GUARDS;
  const perUser = createRateLimiter({ limit: guards.startsPerUserPerMinute, windowMs: 60_000, ...(deps.now ? { now: deps.now } : {}) });
  return [
    {
      method: "POST",
      path: "/v1/sessions",
      handler: async ({ req, res }) => {
        const { userId, orgId } = requireOrg(await deps.auth.authenticate(req));
        // Counted before anything else, invalid and reused requests too: it's a limit on asking.
        const allowed = perUser.take(userId);
        if (!allowed.ok) {
          deps.log("session.start", { org_id: orgId, outcome: "rate_limited" });
          throw new HttpError(429, "rate_limited", "Too many starts in a short time. Try again shortly.",
            { "retry-after": String(allowed.retryAfterSeconds) });
        }
        const parsed = CreateSessionBody.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, "invalid_request", "Send { meetingUrl } with an https Google Meet, Zoom or Teams link.");
        const { meetingUrl } = parsed.data;
        // Checked before anything is saved, so a server that can't start sessions leaves no rows behind.
        if (!deps.db) throw new HttpError(503, "db_unavailable", "The database isn't available on this server.");
        if (!deps.engine) throw new HttpError(503, "engine_unavailable", "Starting meetings isn't available on this server yet.");
        if (!deps.limits) throw new HttpError(503, "limits_unavailable", "Session limits aren't configured on this server.");
        const db = deps.db;
        const limits = deps.limits;

        let created;
        try {
          created = await db.createSessionUnlessActive(orgId, { id: randomUUID(), createdBy: userId, meetingUrl, limits },
            { maxActive: guards.maxActivePerOrg, maxPerDay: guards.maxStartsPerOrgPerDay, activeMarginMinutes: guards.activeMarginMinutes });
        } catch (err) {
          if (!(err instanceof StartLimitError)) throw err;
          deps.log("session.start", { org_id: orgId, outcome: `${err.limit}_limit` });
          throw err.limit === "active"
            ? new HttpError(429, "active_limit_reached", "The organization has its maximum of sessions running. Nothing was started.")
            : new HttpError(429, "daily_limit_reached", "The organization has started its maximum of sessions for the day. Nothing was started.");
        }
        const { session, reused } = created;
        if (reused) {
          deps.log("session.start", { session_id: session.id, org_id: orgId, outcome: "reused" });
          const body: CreateSessionResponse = { session: toSessionView(session), reused: true };
          return sendJson(res, 200, body);
        }

        const outcome = await deps.engine.startSession({ sessionId: session.id, orgId, meetingUrl, limits });
        // Only a `starting` row changes. If something else moved it on meanwhile, show what's there now.
        const saved: SessionRecord = (await db.setSessionStart(orgId, session.id, startResult(outcome)))
          ?? (await db.getSession(orgId, session.id))
          ?? session;
        deps.log("session.start", { session_id: session.id, org_id: orgId, outcome: outcome.kind, status: saved.status });

        if (outcome.kind === "ok") {
          const body: CreateSessionResponse = { session: toSessionView(saved), reused: false };
          return sendJson(res, 201, body);
        }
        const body: StartFailedResponse = outcome.kind === "rejected"
          ? { error: { code: "engine_rejected", message: "The meeting service refused to start this session." }, session: toSessionView(saved) }
          : {
            error: { code: "engine_outcome_unknown", message: "We couldn't confirm whether the session started. Check the meeting before trying again." },
            session: toSessionView(saved),
          };
        sendJson(res, outcome.kind === "rejected" ? 502 : 504, body);
      },
    },
  ];
}
