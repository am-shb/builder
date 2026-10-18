import type { Route } from "../router.ts";
import { sendJson } from "../http.ts";

export const healthRoutes: Route[] = [
  { method: "GET", path: "/health", handler: ({ res }) => sendJson(res, 200, { ok: true }) },
];
