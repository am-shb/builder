// The web app's only way to the api (ADR 0012, plan: "Talking to the api"). Every call sends the Clerk session token
// as a Bearer token and nothing else that identifies the caller: the api takes the org from the token, so no org id is
// ever sent. No cookies, no retries, and no timeout on a start: a retried or cut-off start can send a second paid bot.
import type { z } from "zod";
import { CreateSessionResponse, ErrorBody, MeResponse, SessionList, SessionResponse, type SessionView } from "./schemas.ts";

// Codes the web app makes itself; every other code is the api's.
export type ClientCode = "network_error" | "bad_response" | "signed_out";

// One error type for every failure. The UI branches on `code` and shows its own text, never `message`.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  // The session as saved, when a start failed after the api recorded it (502 and 504).
  readonly session: SessionView | undefined;
  constructor(status: number, code: string, session?: SessionView) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.session = session;
  }
}

// An aborted request (the org changed, the page was left): ignored, nothing shown.
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export type ApiClient = {
  me(signal?: AbortSignal): Promise<MeResponse>;
  listSessions(signal?: AbortSignal): Promise<SessionView[]>;
  getSession(id: string, signal?: AbortSignal): Promise<SessionView>;
  // Never aborted and never retried: aborting would turn a known outcome into an unknown one.
  createSession(meetingUrl: string): Promise<CreateSessionResponse>;
};

export function createApiClient({ baseUrl, getToken, fetch: doFetch = globalThis.fetch }: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}): ApiClient {
  async function call<S extends z.ZodType>(method: "GET" | "POST", path: string, schema: S, opts: { body?: unknown; signal?: AbortSignal } = {}): Promise<z.infer<S>> {
    const token = await getToken();
    if (!token) throw new ApiError(0, "signed_out");
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, {
        method,
        headers,
        credentials: "omit",
        cache: "no-store",
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (isAbort(err) || opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      // Offline, DNS, or the browser refused the reply (CORS).
      throw new ApiError(0, "network_error");
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      if (isAbort(err) || opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      throw new ApiError(res.status, res.ok ? "bad_response" : `http_${res.status}`);
    }
    if (!res.ok) {
      const body = ErrorBody.safeParse(json);
      throw body.success
        ? new ApiError(res.status, body.data.error.code, body.data.session)
        : new ApiError(res.status, `http_${res.status}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError(res.status, "bad_response");
    return parsed.data;
  }

  return {
    me: (signal) => call("GET", "/v1/me", MeResponse, { signal }),
    listSessions: async (signal) => (await call("GET", "/v1/sessions", SessionList, { signal })).sessions,
    getSession: async (id, signal) => (await call("GET", `/v1/sessions/${encodeURIComponent(id)}`, SessionResponse, { signal })).session,
    createSession: (meetingUrl) => call("POST", "/v1/sessions", CreateSessionResponse, { body: { meetingUrl } }),
  };
}
