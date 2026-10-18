// GET /v1/sessions and GET /v1/sessions/:id (step 5 of docs/plans/api-first-slice.md). Any role in the org may
// read. The org always comes from the verified token, never from the query, a header or the path.
import type { Authenticator } from "../auth/clerk.ts";
import { requireOrg } from "../auth/org.ts";
import type { Db } from "../db/index.ts";
import { HttpError, sendJson } from "../http.ts";
import type { Route } from "../router.ts";
import { toSessionView } from "./schemas.ts";
import type { SessionList, SessionResponse } from "./schemas.ts";

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
        // The org's 50 newest. No paging for the hackathon; `limit` and a cursor can be added later.
        const body: SessionList = { sessions: (await needDb().listSessions(orgId)).map(toSessionView) };
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
