// POST /v1/sessions over HTTP, against the fake engine, with test-signed Clerk tokens and in-memory SurrealDB.
// Nothing here calls Clerk, SurrealDB Cloud, the real engine or Recall.
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "../src/server.ts";
import { createEngineClient } from "../src/engine/client.ts";
import type { Db } from "../src/db/index.ts";
import type { SessionLimits } from "../src/contracts.ts";
import { CreateSessionResponse, SessionList, StartFailedResponse } from "../src/routes/schemas.ts";
import { signToken, testClerk } from "./helpers/clerk.ts";
import { testConfig, withServer } from "./helpers/server.ts";
import { testDb } from "./helpers/db.ts";
import { FAKE_ENGINE_TOKEN, startFakeEngine } from "./helpers/fake-engine.ts";
import type { FakeEngine } from "./helpers/fake-engine.ts";

// Only loopback servers started by these tests may be reached. Any other fetch fails the run.
const realFetch = globalThis.fetch;
const outbound: string[] = [];
before(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
    outbound.push(url);
    return Promise.reject(new Error("network disabled in tests"));
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(outbound, [], "something called outside the test servers");
});

let engine: FakeEngine;
beforeEach(async () => {
  engine = await startFakeEngine();
});
afterEach(() => engine.close());

const MEET = "https://meet.google.com/abc-defg-hij";
const LIMITS: SessionLimits = { maxUsd: 5, maxMinutes: 60 };
type Logged = { msg: string; fields?: Record<string, unknown> };

type ApiOptions = { db?: Db | null; engineUrl?: string | null; timeoutMs?: number; limits?: SessionLimits | null };

/** The api with the fake engine (or none), a fresh in-memory db unless given one, and a log it collects. */
async function withApi(opts: ApiOptions, fn: (ctx: { base: string; db: Db; logs: Logged[] }) => Promise<void>) {
  const logs: Logged[] = [];
  const log = (msg: string, fields?: Record<string, unknown>) => void logs.push({ msg, fields });
  const db = opts.db === undefined ? await testDb() : opts.db;
  const engineUrl = opts.engineUrl === undefined ? engine.url : opts.engineUrl;
  const client = engineUrl === null ? null
    : createEngineClient({ config: { url: engineUrl, token: FAKE_ENGINE_TOKEN }, log, timeoutMs: opts.timeoutMs ?? 2_000 });
  const config = testConfig({ clerk: testClerk, defaultLimits: opts.limits === undefined ? LIMITS : opts.limits });
  const server = createServer({ config, db, engine: client, log });
  await withServer(server, (base) => fn({ base, db: db as Db, logs }));
}

const tokenFor = (orgId: string, opts: { rol?: string; userId?: string } = {}) =>
  signToken({ orgId, rol: opts.rol ?? "member", userId: opts.userId ?? `user_${orgId}` });

const post = (base: string, body: unknown, token?: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

// ---- started ----

test("ok: saves the session, starts it once on the engine and answers 201 with it", async () => {
  await withApi({}, async ({ base, db }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a", { userId: "user_1" }));
    assert.equal(res.status, 201);
    const { session, reused } = CreateSessionResponse.parse(await res.json());
    assert.equal(reused, false);
    assert.equal(session.status, "joining");
    assert.equal(session.meetingUrl, MEET);
    assert.equal(session.stageUrl, `https://engine.test/stage/${session.id}?token=stage-secret`);
    assert.equal(session.errorCode, undefined);
    assert.deepEqual(session.limits, LIMITS);
    assert.match(session.id, /^[0-9a-f-]{36}$/);

    assert.deepEqual(engine.accepted, [{ sessionId: session.id, orgId: "org_a", meetingUrl: MEET, limits: LIMITS }]);
    const saved = await db.getSession("org_a", session.id);
    assert.deepEqual([saved?.status, saved?.stageUrl, saved?.createdBy], ["joining", session.stageUrl, "user_1"]);
  });
});

test("the session is saved as starting before the engine is called", async () => {
  engine.behave({ kind: "hang" });
  await withApi({ timeoutMs: 1_500 }, async ({ base, db }) => {
    const pending = post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    for (let i = 0; i < 100 && engine.accepted.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(engine.accepted.length, 1, "the engine got the request");
    const whileWaiting = await db.getSession("org_a", engine.accepted[0].sessionId);
    assert.equal(whileWaiting?.status, "starting", "the row was already there while the engine was working");
    assert.equal((await pending).status, 504);
  });
});

test("admins and members can both start a session", async () => {
  await withApi({}, async ({ base }) => {
    assert.equal((await post(base, { meetingUrl: `${MEET}?1` }, tokenFor("org_a", { rol: "admin" }))).status, 201);
    assert.equal((await post(base, { meetingUrl: `${MEET}?2` }, tokenFor("org_a", { rol: "member" }))).status, 201);
  });
});

// ---- reuse (D7) ----

test("a second start for the same meeting reuses the org's active session: 200, and the engine isn't called again", async () => {
  await withApi({}, async ({ base }) => {
    const first = CreateSessionResponse.parse(await (await post(base, { meetingUrl: MEET }, tokenFor("org_a"))).json());
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a", { userId: "user_other" }));
    assert.equal(res.status, 200);
    const again = CreateSessionResponse.parse(await res.json());
    assert.equal(again.reused, true);
    assert.equal(again.session.id, first.session.id);
    assert.equal(engine.accepted.length, 1, "one bot, not two");
  });
});

test("a double-click (two starts at once) sends one bot", async () => {
  await withApi({}, async ({ base }) => {
    const both = await Promise.all([post(base, { meetingUrl: MEET }, tokenFor("org_a")), post(base, { meetingUrl: MEET }, tokenFor("org_a"))]);
    const bodies = await Promise.all(both.map(async (r) => CreateSessionResponse.parse(await r.json())));
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 201]);
    assert.equal(bodies[0].session.id, bodies[1].session.id);
    assert.equal(engine.accepted.length, 1);
  });
});

test("the same link written differently still counts as the same meeting", async () => {
  await withApi({}, async ({ base }) => {
    const first = CreateSessionResponse.parse(await (await post(base, { meetingUrl: MEET }, tokenFor("org_a"))).json());
    const again = CreateSessionResponse.parse(await (await post(base, { meetingUrl: "  HTTPS://MEET.GOOGLE.COM/abc-defg-hij  " }, tokenFor("org_a"))).json());
    assert.equal(again.session.id, first.session.id);
    assert.equal(again.session.meetingUrl, MEET);
  });
});

test("one org never reuses another org's session, even for the same meeting", async () => {
  await withApi({}, async ({ base, db }) => {
    const a = CreateSessionResponse.parse(await (await post(base, { meetingUrl: MEET }, tokenFor("org_a"))).json());
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_b"));
    assert.equal(res.status, 201, "org_b gets a session of its own");
    const b = CreateSessionResponse.parse(await res.json());
    assert.equal(b.reused, false);
    assert.notEqual(b.session.id, a.session.id);
    assert.notEqual(b.session.stageUrl, a.session.stageUrl, "and never org_a's stage URL");
    assert.deepEqual(engine.accepted.map((r) => r.orgId), ["org_a", "org_b"]);
    assert.equal(await db.getSession("org_b", a.session.id), undefined);
    assert.deepEqual((await db.listSessions("org_b")).map((s) => s.id), [b.session.id]);
  });
});

test("an org in the body, query or headers is ignored: the session belongs to the token's org", async () => {
  await withApi({}, async ({ base, db }) => {
    const res = await fetch(`${base}/v1/sessions?orgId=org_a`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokenFor("org_b")}`, "x-org-id": "org_a" },
      body: JSON.stringify({ meetingUrl: MEET, orgId: "org_a", org: "org_a", limits: { maxUsd: 1_000_000, maxMinutes: 100_000 } }),
    });
    assert.equal(res.status, 201);
    const { session } = CreateSessionResponse.parse(await res.json());
    assert.deepEqual(session.limits, LIMITS, "limits come from config, not the body");
    assert.equal(engine.accepted[0].orgId, "org_b");
    assert.deepEqual(engine.accepted[0].limits, LIMITS);
    assert.equal(await db.getSession("org_a", session.id), undefined);
    assert.ok(await db.getSession("org_b", session.id));
  });
});

test("after a session failed to start, a new start for that meeting makes a new session", async () => {
  engine.behave({ kind: "reply", httpStatus: 409, body: JSON.stringify({ error: { code: "meeting_in_use" } }) });
  await withApi({}, async ({ base }) => {
    const failed = StartFailedResponse.parse(await (await post(base, { meetingUrl: MEET }, tokenFor("org_a"))).json());
    engine.behave({ kind: "ok" });
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 201);
    assert.notEqual(CreateSessionResponse.parse(await res.json()).session.id, failed.session.id);
  });
});

// ---- the engine says no ----

test("rejected: 502 engine_rejected, the session saved as start_failed with the engine's code", async () => {
  engine.behave({ kind: "reply", httpStatus: 422, body: JSON.stringify({ error: { code: "recall_rejected" } }) });
  await withApi({}, async ({ base, db }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 502);
    const body = StartFailedResponse.parse(await res.json());
    assert.equal(body.error.code, "engine_rejected");
    assert.deepEqual([body.session.status, body.session.errorCode, body.session.stageUrl], ["start_failed", "recall_rejected", undefined]);
    assert.equal((await db.getSession("org_a", body.session.id))?.status, "start_failed");
    assert.equal(engine.accepted.length, 1, "no retry");
  });
});

// ---- the engine is down or slow: a bot may or may not exist ----

test("engine slow: no answer before the timeout is 504 engine_outcome_unknown, saved as start_unknown, no retry", async () => {
  engine.behave({ kind: "hang" });
  await withApi({ timeoutMs: 300 }, async ({ base, db }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 504);
    const body = StartFailedResponse.parse(await res.json());
    assert.equal(body.error.code, "engine_outcome_unknown");
    assert.deepEqual([body.session.status, body.session.errorCode], ["start_unknown", "timeout"]);
    assert.equal((await db.getSession("org_a", body.session.id))?.status, "start_unknown");
    assert.equal(engine.received.length, 1, "sent once, never retried");
  });
});

test("engine down: a refused connection is 504 engine_outcome_unknown, saved as start_unknown", async () => {
  const gone = await startFakeEngine();
  const url = gone.url;
  await gone.close();
  await withApi({ engineUrl: url }, async ({ base }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 504);
    const body = StartFailedResponse.parse(await res.json());
    assert.deepEqual([body.error.code, body.session.status, body.session.errorCode], ["engine_outcome_unknown", "start_unknown", "network"]);
  });
});

test("engine errors: a 5xx, a dropped connection or a bad reply are all 504 start_unknown, each sent once", async () => {
  const cases = [
    { behavior: { kind: "reply", httpStatus: 503, body: "{}" }, reason: "server_error" },
    { behavior: { kind: "destroy" }, reason: "network" },
    { behavior: { kind: "ok", sessionId: randomUUID() }, reason: "bad_response" },
  ] as const;
  for (const [i, c] of cases.entries()) {
    engine.behave(c.behavior);
    await withApi({}, async ({ base }) => {
      const before = engine.received.length;
      const res = await post(base, { meetingUrl: `${MEET}?case=${i}` }, tokenFor("org_a"));
      assert.equal(res.status, 504, c.reason);
      const body = StartFailedResponse.parse(await res.json());
      assert.deepEqual([body.session.status, body.session.errorCode], ["start_unknown", c.reason]);
      assert.equal(engine.received.length - before, 1, `${c.reason}: no retry`);
    });
  }
});

// ---- bad requests and missing setup ----

test("a meeting link that isn't an https Meet, Zoom or Teams link is 400 invalid_request, and nothing is saved", async () => {
  await withApi({}, async ({ base, db }) => {
    const bad = [
      {}, { meetingUrl: "" }, { meetingUrl: 42 }, { meetingUrl: "not a url" }, { meetingUrl: "http://meet.google.com/abc" },
      { meetingUrl: "https://evil.example.com/meet.google.com" }, { meetingUrl: "https://meet.google.com.evil.example/abc" },
      { meetingUrl: "https://user:pw@meet.google.com/abc" }, { meetingUrl: `https://meet.google.com/${"a".repeat(2_000)}` }, [MEET],
    ];
    for (const body of bad) {
      const res = await post(base, body, tokenFor("org_a"));
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(await errorCode(res), "invalid_request");
    }
    for (const url of ["https://us02web.zoom.us/j/123", "https://zoom.us/j/1", "https://teams.microsoft.com/l/meetup-join/x", "https://teams.live.com/meet/1"]) {
      assert.equal((await post(base, { meetingUrl: url }, tokenFor("org_a"))).status, 201, url);
    }
    assert.equal(await errorCode(await post(base, "{not json", tokenFor("org_a"))), "invalid_json");
    assert.equal((await post(base, { meetingUrl: MEET }, tokenFor("org_a"), { "content-type": "text/plain" })).status, 415);
    assert.equal((await db.listSessions("org_a")).length, 4, "only the good links were saved");
    assert.equal(engine.accepted.length, 4);
  });
});

test("401 without a valid token and 403 without an active org, before anything is saved or sent", async () => {
  await withApi({}, async ({ base, db }) => {
    for (const token of [undefined, "junk", signToken({ orgId: "org_a", expiresIn: -60 })]) {
      const res = await post(base, { meetingUrl: MEET }, token);
      assert.equal(res.status, 401);
      assert.equal(await errorCode(res), "unauthenticated");
    }
    const noOrg = await post(base, { meetingUrl: MEET }, signToken({ orgId: null }));
    assert.equal(noOrg.status, 403);
    assert.equal(await errorCode(noOrg), "no_active_org");
    assert.deepEqual(await db.listSessions("org_a"), []);
    assert.equal(engine.received.length, 0);
  });
});

test("503 when the engine, the limits or the database aren't configured, with nothing saved", async () => {
  const db = await testDb();
  await withApi({ db, engineUrl: null }, async ({ base }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 503);
    assert.equal(await errorCode(res), "engine_unavailable");
  });
  await withApi({ db, limits: null }, async ({ base }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 503);
    assert.equal(await errorCode(res), "limits_unavailable");
  });
  await withApi({ db: null }, async ({ base }) => {
    const res = await post(base, { meetingUrl: MEET }, tokenFor("org_a"));
    assert.equal(res.status, 503);
    assert.equal(await errorCode(res), "db_unavailable");
  });
  assert.deepEqual(await db.listSessions("org_a"), []);
  assert.equal(engine.received.length, 0);
});

test("a started session shows up in GET /v1/sessions for its org only", async () => {
  await withApi({}, async ({ base }) => {
    const { session } = CreateSessionResponse.parse(await (await post(base, { meetingUrl: MEET }, tokenFor("org_a"))).json());
    const listA = SessionList.parse(await (await fetch(`${base}/v1/sessions`, { headers: { authorization: `Bearer ${tokenFor("org_a")}` } })).json());
    assert.deepEqual(listA.sessions.map((s) => s.id), [session.id]);
    const listB = SessionList.parse(await (await fetch(`${base}/v1/sessions`, { headers: { authorization: `Bearer ${tokenFor("org_b")}` } })).json());
    assert.deepEqual(listB.sessions, []);
  });
});

test("logs carry ids and outcomes, never the meeting URL, stage URL or token", async () => {
  await withApi({}, async ({ base, logs }) => {
    const token = tokenFor("org_a");
    await post(base, { meetingUrl: MEET }, token);
    await post(base, { meetingUrl: MEET }, token);
    const text = JSON.stringify(logs);
    for (const secret of ["meet.google.com", "engine.test/stage", "stage-secret", token, FAKE_ENGINE_TOKEN]) assert.ok(!text.includes(secret), secret);
    const outcomes = logs.filter((l) => l.msg === "session.start").map((l) => l.fields?.outcome);
    assert.deepEqual(outcomes, ["ok", "reused"]);
  });
});
