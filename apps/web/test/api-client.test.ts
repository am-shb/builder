import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, isAbort } from "../src/api/client.ts";
import { API, errorBody, fakeApi, session } from "./helpers/fake-api.ts";

const client = (api: ReturnType<typeof fakeApi>, token: string | null = "token-org_a") =>
  createApiClient({ baseUrl: API, getToken: async () => token, fetch: api.fetch });

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("expected a failure");
}

describe("every request", () => {
  it("sends the Bearer token, asks for JSON, sends no cookies, and never an org id", async () => {
    const api = fakeApi({
      "GET /v1/sessions": { status: 200, body: { sessions: [session()] } },
      "POST /v1/sessions": { status: 201, body: { session: session(), reused: false } },
    });
    const c = client(api);
    await c.listSessions();
    await c.createSession("https://meet.google.com/abc-defg-hij");
    for (const r of api.requests) {
      expect(r.headers.Authorization).toBe("Bearer token-org_a");
      expect(r.headers.Accept).toBe("application/json");
      expect(r.credentials).toBe("omit");
      expect(JSON.stringify(r).toLowerCase()).not.toMatch(/org_?id|organization/);
    }
    const post = api.requests[1]!;
    expect(post.headers["Content-Type"]).toBe("application/json");
    expect(post.body).toEqual({ meetingUrl: "https://meet.google.com/abc-defg-hij" });
  });

  it("with no token, sends nothing", async () => {
    const api = fakeApi();
    expect((await failure(client(api, null).me())).code).toBe("signed_out");
    expect(api.requests).toHaveLength(0);
  });

  it("escapes the session id in the path", async () => {
    const api = fakeApi();
    await failure(client(api).getSession("a/../b"));
    expect(api.requests[0]!.path).toBe("/v1/sessions/a%2F..%2Fb");
  });
});

describe("replies", () => {
  it("reads the role, a list and a session", async () => {
    const api = fakeApi({
      "GET /v1/me": { status: 200, body: { userId: "user_1", orgId: "org_a", role: "org:admin" } },
      "GET /v1/sessions": { status: 200, body: { sessions: [session()] } },
      [`GET /v1/sessions/${session().id}`]: { status: 200, body: { session: session() } },
    });
    const c = client(api);
    expect((await c.me()).role).toBe("org:admin");
    expect(await c.listSessions()).toHaveLength(1);
    expect((await c.getSession(session().id)).status).toBe("in_meeting");
  });

  it("tolerates a new field and a new status", async () => {
    const api = fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: [{ ...session(), status: "paused", newField: 1 }], cursor: "x" } } });
    const [s] = await client(api).listSessions();
    expect(s!.status).toBe("paused");
  });

  it("an api error becomes its code, with the session a failed start carries", async () => {
    const saved = session({ status: "start_failed", errorCode: "recall_rejected" });
    const api = fakeApi({ "POST /v1/sessions": { status: 502, body: errorBody("engine_rejected", { session: saved }) } });
    const err = await failure(client(api).createSession("https://meet.google.com/x"));
    expect([err.status, err.code, err.session?.errorCode]).toEqual([502, "engine_rejected", "recall_rejected"]);
  });

  it("a fetch that throws is network_error; an unreadable or wrong reply is bad_response", async () => {
    expect((await failure(client(fakeApi({ "GET /v1/me": "network_error" })).me())).code).toBe("network_error");
    expect((await failure(client(fakeApi({ "GET /v1/me": { status: 200, raw: "<html>" } })).me())).code).toBe("bad_response");
    expect((await failure(client(fakeApi({ "GET /v1/me": { status: 200, body: { nope: true } } })).me())).code).toBe("bad_response");
    expect((await failure(client(fakeApi({ "GET /v1/me": { status: 500, raw: "oops" } })).me())).code).toBe("http_500");
  });

  it("an aborted request is an abort, not an error to show", async () => {
    const controller = new AbortController();
    const api = fakeApi({ "GET /v1/sessions": (_req, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
    const pending = client(api).listSessions(controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbort);
  });

  it("never retries: one request per call, even after a failure", async () => {
    for (const reply of ["network_error", { status: 500, body: errorBody("internal_error") }, { status: 504, body: errorBody("engine_outcome_unknown", { session: session({ status: "start_unknown" }) }) }] as const) {
      const api = fakeApi({ "POST /v1/sessions": reply });
      await failure(client(api).createSession("https://meet.google.com/x"));
      expect(api.requests).toHaveLength(1);
    }
  });

  it("a start has no timeout of its own: it waits for the api's answer", async () => {
    vi.useFakeTimers();
    try {
      let answer!: (r: Response) => void;
      const api = fakeApi({ "POST /v1/sessions": () => new Promise<Response>((resolve) => { answer = resolve; }) });
      const started = client(api).createSession("https://meet.google.com/x");
      await vi.advanceTimersByTimeAsync(120_000);
      answer(new Response(JSON.stringify({ session: session(), reused: false }), { status: 201 }));
      expect((await started).reused).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
