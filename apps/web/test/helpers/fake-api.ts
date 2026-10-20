// The api, faked as a `fetch` (plan: "Testing"). It records every request and answers from routes set per test; a route
// it doesn't know answers 404 not_found, like the api. Replies are built from the web's schemas (WC1 will switch them to
// @builder/contracts), so a shape change shows up here.
import { SessionView } from "../../src/api/schemas.ts";

export const API = "http://api.test";

export type Recorded = { method: string; url: string; path: string; headers: Record<string, string>; body: unknown; credentials: string | undefined };
type Reply = { status: number; body?: unknown; raw?: string } | "network_error" | ((req: Recorded, signal?: AbortSignal) => Promise<Response>);

export function session(over: Partial<SessionView> = {}): SessionView {
  return SessionView.parse({
    id: "11111111-1111-4111-8111-111111111111",
    meetingUrl: "https://meet.google.com/kfp-qzwd-nre",
    status: "in_meeting",
    limits: { maxUsd: 5, maxMinutes: 60 },
    createdAt: "2026-10-20T14:00:00.000Z",
    updatedAt: "2026-10-20T14:01:00.000Z",
    ...over,
  });
}

export const errorBody = (code: string, extra: Record<string, unknown> = {}) => ({ error: { code, message: `api says ${code}` }, ...extra });

export function fakeApi(routes: Record<string, Reply> = {}) {
  const requests: Recorded[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const req: Recorded = {
      method, url, path: url.startsWith(API) ? url.slice(API.length) : url,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      credentials: init.credentials,
    };
    requests.push(req);
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const reply = routes[`${method} ${req.path}`] ?? { status: 404, body: errorBody("not_found") };
    if (reply === "network_error") throw new TypeError("Failed to fetch");
    if (typeof reply === "function") return reply(req, init.signal ?? undefined);
    const text = reply.raw ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}
