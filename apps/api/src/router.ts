// A small router: exact segments and `:name` params. Unknown path → 404 not_found; known path with another
// method → 405 method_not_allowed with an Allow header (docs/adr/0010-api-stack.md).
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, sendError } from "./http.ts";

export type Log = (msg: string, fields?: Record<string, unknown>) => void;

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  url: URL;
};

export type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handler: (ctx: RouteContext) => unknown;
};

export type Match =
  | { kind: "found"; route: Route; params: Record<string, string> }
  | { kind: "method_not_allowed"; allow: string[] }
  | { kind: "not_found" };

const split = (path: string) => path.split("/").filter(Boolean);

function matchPath(pattern: string[], segments: string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(":")) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segments[i]);
      } catch {
        return null;
      }
      params[p.slice(1)] = decoded;
    } else if (p !== segments[i]) {
      return null;
    }
  }
  return params;
}

export function createRouter(routes: Route[]) {
  const compiled = routes.map((route) => ({ route, pattern: split(route.path) }));
  return {
    match(method: string, path: string): Match {
      const segments = split(path);
      const allow: string[] = [];
      for (const { route, pattern } of compiled) {
        const params = matchPath(pattern, segments);
        if (!params) continue;
        if (route.method === method) return { kind: "found", route, params };
        allow.push(route.method);
      }
      return allow.length ? { kind: "method_not_allowed", allow } : { kind: "not_found" };
    },
  };
}

/**
 * Turns routes into a node:http request handler. An HttpError answers with its status and code. Anything else
 * answers 500 and is logged by error name only: messages can quote request bodies.
 */
export function createHandler(routes: Route[], log: Log) {
  const router = createRouter(routes);
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://api.local");
    const match = router.match(req.method ?? "GET", url.pathname);
    if (match.kind === "not_found") return sendError(res, 404, "not_found", "No such route.");
    if (match.kind === "method_not_allowed") {
      return sendError(res, 405, "method_not_allowed", "This route doesn't accept that method.", { allow: match.allow.join(", ") });
    }
    try {
      await match.route.handler({ req, res, params: match.params, url });
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendError(res, err.status, err.code, err.message);
        return;
      }
      log("http.error", { route: `${match.route.method} ${match.route.path}`, error: err instanceof Error ? err.name : "unknown" });
      if (!res.headersSent) sendError(res, 500, "internal_error", "Something went wrong.");
      else res.destroy();
    }
  };
}
