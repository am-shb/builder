// POST /internal/engine-events: the engine tells the api what happened to a session (A2 in
// docs/plans/api-first-slice.md, ADR 0008). One event from @builder/contracts per call. Only `session.status` is
// stored for now; usage and hand-off events are acknowledged and skipped until their slices.
//
// Not for browsers: no Clerk, no CORS. It needs the shared bearer token (ENGINE_INTERNAL_TOKEN, the one the api
// sends the engine), compared in constant time, and answers 404 when that isn't set or when the request came
// through a public proxy, the same check the engine makes on its own /internal routes. The engine's reporter
// (apps/engine/src/api-events.ts) tries again on 401, 5xx, network errors and a 404 for the route itself (an api
// without this route, mid-deploy), and drops an event on any other 4xx, such as 404 session_not_found.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { parseEngineEvent } from "../contracts.ts";
import type { Db } from "../db/index.ts";
import { HttpError, readJson, sendJson } from "../http.ts";
import type { Log, Route } from "../router.ts";

export const ENGINE_EVENTS_PATH = "/internal/engine-events";

// An event is a few hundred bytes.
const MAX_EVENT_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Error codes are stored and shown through the web app's own messages, so only plain codes are kept.
const CODE = /^[a-z0-9_]{1,64}$/;

// Requests through a public proxy carry these; the engine's calls on the private network don't.
const viaProxy = (req: IncomingMessage) =>
  Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]);

const bearer = (req: IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "")?.[1] ?? null;

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => new HttpError(404, "not_found", "No such route.");

export function engineEventRoutes(deps: { db: Db | null; token: string | null; log: Log }): Route[] {
  return [{
    method: "POST",
    path: ENGINE_EVENTS_PATH,
    handler: async ({ req, res }) => {
      // Off, or not from the private network: as if the route weren't there.
      if (!deps.token || viaProxy(req)) throw notFound();
      if (!tokenMatches(bearer(req), deps.token)) throw new HttpError(401, "unauthorized", "A valid token is required.");
      const parsed = parseEngineEvent(await readJson(req, MAX_EVENT_BYTES));
      if (parsed.kind === "invalid") throw new HttpError(400, "invalid_event", "The event doesn't match the contract.");
      if (parsed.kind === "unknown") {
        deps.log("engine_event.skipped", { type: parsed.type.slice(0, 64) });
        return sendJson(res, 202, { applied: false });
      }
      const event = parsed.event;
      if (event.type !== "session.status") {
        deps.log("engine_event.skipped", { type: event.type, session_id: event.sessionId });
        return sendJson(res, 202, { applied: false });
      }
      // The engine tries again on a 503, so nothing is lost while the database is away.
      if (!deps.db) throw new HttpError(503, "db_unavailable", "The database isn't available on this server.");
      const code = event.errorCode === undefined ? null : CODE.test(event.errorCode) ? event.errorCode : "engine_error";
      const outcome = UUID.test(event.sessionId)
        ? await deps.db.applyStatusEvent(event.orgId, event.sessionId, event.status, code)
        : "not_found";
      deps.log("engine_event.status", { session_id: event.sessionId, org_id: event.orgId, status: event.status, outcome });
      if (outcome === "not_found") throw new HttpError(404, "session_not_found", "No such session in that organization.");
      // Final for this event: the engine drops it on a 409.
      if (outcome === "conflict") throw new HttpError(409, "meeting_in_use", "Another session of the organization holds this meeting link.");
      sendJson(res, 200, { applied: outcome === "applied" });
    },
  }];
}
