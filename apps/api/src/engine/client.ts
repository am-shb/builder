// The api's client for the engine's internal boundary (ADR 0008): POST {engine}/internal/sessions.
//
// The one question every caller needs answered is "could a bot be in that meeting now?":
// - ok:       the engine started the session.
// - rejected: the engine definitely didn't start one for this call (it answered 4xx, or we never sent it).
// - unknown:  it might have. Timeout, network error, 5xx, redirect, or a reply that doesn't parse.
// There are no automatic retries: a retry can send a second paid bot (docs/adr/0010-api-stack.md).
// Until contracts C1 defines the engine's error codes, every 5xx is `unknown`, the safe reading.
//
// Logs carry ids, the outcome, the HTTP status and the duration. Never the meeting URL, stage URL or token.
import type { EngineConfig } from "../config.ts";
import type { Log } from "../router.ts";
import { StartSessionRequestSchema, StartSessionResponseSchema } from "../contracts.ts";
import type { StartSessionRequest, StartSessionResponse } from "../contracts.ts";

export const START_SESSION_PATH = "/internal/sessions";
// Longer than the engine's own Recall call (D14 in docs/plans/api-first-slice.md).
export const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REPLY_BYTES = 64_000;

export type UnknownReason = "timeout" | "network" | "server_error" | "bad_response";

export type StartOutcome =
  | { kind: "ok"; response: StartSessionResponse }
  | { kind: "rejected"; code: string; httpStatus: number | null }
  | { kind: "unknown"; reason: UnknownReason; httpStatus: number | null };

export type EngineClient = { startSession(req: StartSessionRequest): Promise<StartOutcome> };

export type EngineClientDeps = {
  config: EngineConfig;
  log: Log;
  fetch?: typeof fetch;
  timeoutMs?: number;
  clock?: () => number;
};

// Codes from the engine are logged and stored, so only short plain tokens get through.
const safeCode = (v: unknown) => (typeof v === "string" && /^[a-z0-9_.-]{1,64}$/i.test(v) ? v : null);

function errorCodeOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown } | null;
    const err = parsed?.error;
    // { error: { code } } is the shape ADR 0010 uses and C1 proposes; the engine's v0 routes use { error: "text" }.
    return err && typeof err === "object" ? safeCode((err as { code?: unknown }).code) : null;
  } catch {
    return null;
  }
}

export function createEngineClient(deps: EngineClientDeps): EngineClient {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clock = deps.clock ?? Date.now;
  const url = `${deps.config.url}${START_SESSION_PATH}`;

  async function send(req: StartSessionRequest): Promise<StartOutcome> {
    const parsed = StartSessionRequestSchema.safeParse(req);
    // Nothing was sent, so no bot exists. It's our own bug, so the code says so.
    if (!parsed.success) return { kind: "rejected", code: "invalid_request", httpStatus: null };

    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${deps.config.token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(parsed.data),
        // A redirect would carry the bearer token somewhere else. Refuse it; the outcome is then unknown.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return { kind: "unknown", reason: name === "TimeoutError" ? "timeout" : "network", httpStatus: null };
    }

    let body: string;
    try {
      body = await res.text();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return { kind: "unknown", reason: name === "TimeoutError" ? "timeout" : "network", httpStatus: res.status };
    }

    if (res.status >= 400 && res.status < 500) {
      return { kind: "rejected", code: errorCodeOf(body) ?? `http_${res.status}`, httpStatus: res.status };
    }
    if (res.status >= 500) return { kind: "unknown", reason: "server_error", httpStatus: res.status };
    // A 2xx that isn't StartSessionResponse for this session could still mean a bot was sent.
    if (res.status < 200 || res.status >= 300 || body.length > MAX_REPLY_BYTES) {
      return { kind: "unknown", reason: "bad_response", httpStatus: res.status };
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { kind: "unknown", reason: "bad_response", httpStatus: res.status };
    }
    const reply = StartSessionResponseSchema.safeParse(json);
    if (!reply.success || reply.data.sessionId !== parsed.data.sessionId) {
      return { kind: "unknown", reason: "bad_response", httpStatus: res.status };
    }
    return { kind: "ok", response: reply.data };
  }

  return {
    async startSession(req) {
      const started = clock();
      const outcome = await send(req);
      deps.log("engine.start_session", {
        session_id: typeof req?.sessionId === "string" ? req.sessionId : null,
        org_id: typeof req?.orgId === "string" ? req.orgId : null,
        outcome: outcome.kind,
        ...(outcome.kind === "rejected" ? { code: outcome.code } : {}),
        ...(outcome.kind === "unknown" ? { reason: outcome.reason } : {}),
        ...(outcome.kind === "ok" ? { status: outcome.response.status } : {}),
        http_status: outcome.kind === "ok" ? null : outcome.httpStatus,
        ms: clock() - started,
      });
      return outcome;
    },
  };
}
