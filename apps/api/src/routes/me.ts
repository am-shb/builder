// GET /v1/me: who the token says you are, in which org and with which role (D10 in docs/plans/api-first-slice.md).
import type { Authenticator } from "../auth/clerk.ts";
import { requireOrg } from "../auth/org.ts";
import { sendJson } from "../http.ts";
import type { Route } from "../router.ts";

export function meRoutes(auth: Authenticator): Route[] {
  return [
    {
      method: "GET",
      path: "/v1/me",
      handler: async ({ req, res }) => {
        const { userId, orgId, role } = requireOrg(await auth.authenticate(req));
        sendJson(res, 200, { userId, orgId, role });
      },
    },
  ];
}
