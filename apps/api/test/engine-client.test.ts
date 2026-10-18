import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createEngineClient, DEFAULT_TIMEOUT_MS } from "../src/engine/client.ts";
import type { StartOutcome } from "../src/engine/client.ts";
import type { StartSessionRequest } from "../src/contracts.ts";
import { FAKE_ENGINE_TOKEN, startFakeEngine } from "./helpers/fake-engine.ts";
import type { FakeEngine } from "./helpers/fake-engine.ts";

// Only the local fake may be reached. Any other fetch (the real engine, Recall, a model) fails the run.
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
  assert.deepEqual(outbound, [], "the client made a call outside the fake engine");
});

let engine: FakeEngine;
let lines: Array<Record<string, unknown>>;
beforeEach(async () => {
  engine = await startFakeEngine();
  lines = [];
});
afterEach(() => engine.close());

const log = (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, ...fields });
const client = (over: { token?: string; url?: string; timeoutMs?: number } = {}) =>
  createEngineClient({ config: { url: over.url ?? engine.url, token: over.token ?? FAKE_ENGINE_TOKEN }, log, timeoutMs: over.timeoutMs });

const MEETING = "https://meet.google.com/abc-defg-hij";
const request = (over: Partial<StartSessionRequest> = {}): StartSessionRequest => ({
  sessionId: randomUUID(),
  orgId: "org_test_a",
  meetingUrl: MEETING,
  limits: { maxUsd: 5, maxMinutes: 60 },
  ...over,
});

const unknown = (o: StartOutcome, reason: string) => {
  assert.equal(o.kind, "unknown", JSON.stringify(o));
  assert.equal(o.kind === "unknown" && o.reason, reason);
};

// ---- the happy path ----

test("ok: posts the request with the bearer token and returns the parsed reply", async () => {
  const req = request();
  const out = await client().startSession(req);
  assert.equal(out.kind, "ok");
  assert.deepEqual(out.kind === "ok" && out.response, {
    sessionId: req.sessionId, status: "joining", stageUrl: `https://engine.test/stage/${req.sessionId}?token=stage-secret`,
  });
  assert.equal(engine.received.length, 1);
  assert.equal(engine.received[0].method, "POST");
  assert.equal(engine.received[0].path, "/internal/sessions");
  assert.equal(engine.received[0].authorization, `Bearer ${FAKE_ENGINE_TOKEN}`);
  assert.deepEqual(engine.accepted, [req]);
});

test("ok: unknown keys in the reply are ignored, and other statuses come through", async () => {
  engine.behave({ kind: "ok", status: "in_meeting", httpStatus: 200, extra: { somethingNew: 1 } });
  const out = await client().startSession(request());
  assert.ok(out.kind === "ok");
  assert.equal(out.response.status, "in_meeting");
  assert.equal("somethingNew" in out.response, false);
});

test("the request is checked before sending: a bad one is rejected and never reaches the engine", async () => {
  for (const bad of [request({ meetingUrl: "not a url" }), request({ orgId: "" }), request({ limits: { maxUsd: -1, maxMinutes: 60 } })]) {
    const out = await client().startSession(bad);
    assert.deepEqual(out, { kind: "rejected", code: "invalid_request", httpStatus: null });
  }
  assert.equal(engine.received.length, 0);
});

// ---- the engine said no: definitely no bot from this call ----

test("4xx is rejected, with the engine's error code when it sends one", async () => {
  engine.behave({ kind: "reply", httpStatus: 409, body: JSON.stringify({ error: { code: "meeting_in_use" } }) });
  assert.deepEqual(await client().startSession(request()), { kind: "rejected", code: "meeting_in_use", httpStatus: 409 });
});

test("4xx without a usable code is rejected as http_<status>", async () => {
  const bodies = ['{"error":"plain text, as the v0 routes send"}', "not json", '{"error":{"code":"has spaces and is far too long to keep around as a code value"}}'];
  for (const body of bodies) {
    engine.behave({ kind: "reply", httpStatus: 422, body });
    assert.deepEqual(await client().startSession(request()), { kind: "rejected", code: "http_422", httpStatus: 422 });
  }
});

test("a wrong token is rejected by the engine with 401", async () => {
  assert.deepEqual(await client({ token: "wrong-token-wrong-token-wrong-token" }).startSession(request()),
    { kind: "rejected", code: "unauthorized", httpStatus: 401 });
  assert.equal(engine.accepted.length, 0);
});

// ---- might have sent a bot: unknown ----

test("5xx is unknown, even with an error code, until contracts C1 defines the definite ones", async () => {
  for (const httpStatus of [500, 502, 503, 504]) {
    engine.behave({ kind: "reply", httpStatus, body: JSON.stringify({ error: { code: "recall_rejected" } }) });
    const out = await client().startSession(request());
    unknown(out, "server_error");
    assert.equal(out.kind === "unknown" && out.httpStatus, httpStatus);
  }
});

test("a 2xx that isn't a StartSessionResponse for this session is unknown", async () => {
  const cases: Array<Parameters<FakeEngine["behave"]>[0]> = [
    { kind: "reply", httpStatus: 201, body: "{not json" },
    { kind: "reply", httpStatus: 201, body: JSON.stringify({ sessionId: "x", status: "paused", stageUrl: "https://engine.test/s" }) },
    { kind: "reply", httpStatus: 201, body: JSON.stringify({ ok: true }) },
    { kind: "reply", httpStatus: 204, body: "" },
    { kind: "reply", httpStatus: 201, body: JSON.stringify({ pad: "x".repeat(70_000) }) },
    { kind: "ok", sessionId: randomUUID() }, // a reply about some other session
  ];
  for (const b of cases) {
    engine.behave(b);
    unknown(await client().startSession(request()), "bad_response");
  }
});

test("no reply before the timeout is unknown, and there is no retry", async () => {
  engine.behave({ kind: "hang" });
  const started = Date.now();
  unknown(await client({ timeoutMs: 150 }).startSession(request()), "timeout");
  assert.ok(Date.now() - started < 2_000);
  assert.equal(engine.received.length, 1);
  assert.ok(DEFAULT_TIMEOUT_MS >= 20_000);
});

test("a dropped connection is unknown, and there is no retry", async () => {
  engine.behave({ kind: "destroy" });
  unknown(await client().startSession(request()), "network");
  assert.equal(engine.received.length, 1);
});

test("an engine that isn't listening is unknown (network)", async () => {
  const url = engine.url;
  await engine.close();
  unknown(await client({ url }).startSession(request()), "network");
  engine = await startFakeEngine(); // for afterEach
});

test("a redirect isn't followed, so the token never goes anywhere else", async () => {
  const elsewhere = await startFakeEngine();
  try {
    engine.behave({ kind: "redirect", location: `${elsewhere.url}/internal/sessions` });
    unknown(await client().startSession(request()), "network");
    assert.equal(elsewhere.received.length, 0);
  } finally {
    await elsewhere.close();
  }
});

// ---- logs ----

test("each call logs ids, the outcome, status and duration, never the meeting URL, stage URL or token", async () => {
  const req = request();
  await client().startSession(req);
  engine.behave({ kind: "reply", httpStatus: 409, body: JSON.stringify({ error: { code: "meeting_in_use" } }) });
  await client().startSession(request());
  engine.behave({ kind: "reply", httpStatus: 503, body: "{}" });
  await client().startSession(request());

  assert.equal(lines.length, 3);
  assert.deepEqual({ ...lines[0], ms: 0 }, { msg: "engine.start_session", session_id: req.sessionId, org_id: "org_test_a", outcome: "ok", status: "joining", http_status: null, ms: 0 });
  assert.equal(lines[1].outcome, "rejected");
  assert.equal(lines[1].code, "meeting_in_use");
  assert.equal(lines[1].http_status, 409);
  assert.equal(lines[2].outcome, "unknown");
  assert.equal(lines[2].reason, "server_error");
  const text = JSON.stringify(lines);
  for (const secret of [MEETING, "meet.google.com", "stage-secret", "engine.test/stage", FAKE_ENGINE_TOKEN]) {
    assert.ok(!text.includes(secret), `log leaks ${secret}`);
  }
});
