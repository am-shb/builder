// POST /internal/engine-events (A2, ADR 0008) and the database rules behind it, against in-memory SurrealDB. Events
// are built with the @builder/contracts schema, as the engine builds them. Nothing here calls Clerk, SurrealDB Cloud,
// the engine or Recall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SessionStatusEvent, SessionUsageEvent } from "@builder/contracts";
import type { SessionStatus } from "@builder/contracts";
import { createServer } from "../src/server.ts";
import type { Db, SessionRecord } from "../src/db/index.ts";
import { ENGINE_EVENTS_PATH } from "../src/routes/engine-events.ts";
import { testConfig, withServer } from "./helpers/server.ts";
import { testDb } from "./helpers/db.ts";

const TOKEN = "engine-internal-token-0123456789abcdef";
const LIMITS = { maxUsd: 5, maxMinutes: 60 };
let meetings = 0;
const newMeeting = () => `https://meet.google.com/aaa-bbbb-${String(++meetings).padStart(3, "0")}`;

type Logged = { msg: string; fields?: Record<string, unknown> };

/** The api with events on (the engine's token set), a fresh database, and its log lines. */
async function api(opts: { token?: string | null; db?: Db | null } = {}) {
  // null only for the "no database" test, which never reads it.
  const db = (opts.db === undefined ? await testDb() : opts.db) as Db;
  const logs: Logged[] = [];
  const token = opts.token === undefined ? TOKEN : opts.token;
  const config = testConfig({ engine: token ? { url: "http://127.0.0.1:9", token } : null, clerk: { jwtKey: "unused", authorizedParties: ["http://localhost:5173"] } as never });
  const auth = { authenticate: async () => { throw new Error("no browser routes in these tests"); } } as never;
  const server = createServer({ config, db, engine: null, auth, log: (msg, fields) => logs.push({ msg, fields }) });
  return { db, logs, server };
}

/** A session as the api writes it on a start: `starting`, in `orgId`. */
async function startedSession(db: Db, orgId = "org_a", createdBy = "user_1"): Promise<SessionRecord> {
  await db.upsertOrg(orgId);
  return (await db.createSessionUnlessActive(orgId, { id: randomUUID(), createdBy, meetingUrl: newMeeting(), limits: LIMITS })).session;
}

const statusEvent = (s: { id: string }, status: SessionStatus, over: Record<string, unknown> = {}) => SessionStatusEvent.parse({
  id: `${s.id}:status:${status}`, type: "session.status", sessionId: s.id, orgId: "org_a", at: new Date().toISOString(), status, ...over,
});

function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${ENGINE_EVENTS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const current = async (db: Db, s: { id: string }, orgId = "org_a") => (await db.getSession(orgId, s.id))!;

// ---- who may call it ----

test("without the engine's token configured, the route isn't there", async () => {
  const { db, server } = await api({ token: null });
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    const res = await post(base, statusEvent(s, "in_meeting"));
    assert.equal(res.status, 404);
  });
  assert.equal((await current(db, s)).status, "starting");
});

test("a request through a public proxy is answered as if the route weren't there", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    const proxied: Record<string, string>[] = [{ "x-forwarded-for": "203.0.113.9" }, { "x-forwarded-host": "api.example.com" }, { "cf-connecting-ip": "203.0.113.9" }];
    for (const h of proxied) {
      assert.equal((await post(base, statusEvent(s, "in_meeting"), h)).status, 404, JSON.stringify(h));
    }
  });
  assert.equal((await current(db, s)).status, "starting");
});

test("a missing or wrong token is 401, and nothing changes", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    // Same length as the real one, one character off: only the comparison itself can refuse it.
    const sameLength = `${TOKEN.slice(0, -1)}${TOKEN.endsWith("f") ? "e" : "f"}`;
    for (const auth of ["", "Bearer", `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, `Basic ${TOKEN}`, `Bearer ${sameLength}`, `Bearer ${"x".repeat(TOKEN.length)}`]) {
      const res = await post(base, statusEvent(s, "in_meeting"), { authorization: auth });
      assert.equal(res.status, 401, auth);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, "unauthorized");
    }
  });
  assert.equal((await current(db, s)).status, "starting");
});

test("a browser's preflight to it gets no CORS answer, and a reply never names the caller as allowed", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    const pre = await fetch(`${base}${ENGINE_EVENTS_PATH}`, { method: "OPTIONS", headers: { origin: "https://evil.example.com" } });
    assert.notEqual(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
    const res = await post(base, statusEvent(s, "joining"), { origin: "https://evil.example.com" });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});

// ---- what it accepts ----

test("malformed bodies: not JSON 415/400, too large 413, not the contract 400", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    assert.equal((await post(base, "{", {})).status, 400);
    assert.equal((await post(base, statusEvent(s, "joining"), { "content-type": "text/plain" })).status, 415);
    assert.equal((await post(base, { ...statusEvent(s, "joining"), padding: "x".repeat(20_000) })).status, 413);
    for (const bad of [{}, { ...statusEvent(s, "joining"), status: "dancing" }, { ...statusEvent(s, "joining"), at: "yesterday" }, { ...statusEvent(s, "joining"), sessionId: "" }]) {
      const res = await post(base, bad);
      assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 80));
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, "invalid_event");
    }
  });
  assert.equal((await current(db, s)).status, "starting");
});

test("usage and unknown event types are acknowledged with 202 and change nothing", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    const usage = SessionUsageEvent.parse({ id: "u1", type: "session.usage", sessionId: s.id, orgId: "org_a", at: new Date().toISOString(), botMinutes: 3, modelUsd: 0.2, ttsChars: 10 });
    assert.equal((await post(base, usage)).status, 202);
    assert.equal((await post(base, { type: "session.something_new", id: "x" })).status, 202);
  });
  assert.equal((await current(db, s)).status, "starting");
});

// ---- what it does ----

test("statuses move forward only: joining, in the meeting, ended; late and repeated events change nothing", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  const steps: [SessionStatus, number, boolean, string][] = [
    ["joining", 200, true, "joining"],
    ["joining", 200, false, "joining"],
    ["in_meeting", 200, true, "in_meeting"],
    ["joining", 200, false, "in_meeting"],
    ["ended", 200, true, "ended"],
    ["in_meeting", 200, false, "ended"],
    ["failed", 200, false, "ended"],
  ];
  await withServer(server, async (base) => {
    for (const [status, http, applied, after] of steps) {
      const res = await post(base, statusEvent(s, status));
      assert.equal(res.status, http);
      assert.deepEqual(await res.json(), { applied }, `${status}`);
      assert.equal((await current(db, s)).status, after, `after ${status}`);
    }
  });
});

test("a session can skip straight to ended or failed, and failed keeps its code", async () => {
  const { db, server } = await api();
  const a = await startedSession(db), b = await startedSession(db);
  await withServer(server, async (base) => {
    await post(base, statusEvent(a, "ended", { errorCode: "max_minutes" }));
    await post(base, statusEvent(b, "failed", { errorCode: "meeting_not_found" }));
  });
  assert.deepEqual([(await current(db, a)).status, (await current(db, a)).errorCode], ["ended", "max_minutes"]);
  assert.deepEqual([(await current(db, b)).status, (await current(db, b)).errorCode], ["failed", "meeting_not_found"]);
});

test("an error code that isn't a plain code is stored as engine_error", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    await post(base, statusEvent(s, "failed", { errorCode: "<script>alert(1)</script>" }));
  });
  assert.equal((await current(db, s)).errorCode, "engine_error");
});

test("start_unknown resolves to the real status (the bot did exist), and its old code is cleared", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await db.setSessionStart("org_a", s.id, { kind: "unknown", errorCode: "timeout" });
  await withServer(server, async (base) => {
    assert.deepEqual(await (await post(base, statusEvent(s, "in_meeting"))).json(), { applied: true });
  });
  assert.deepEqual([(await current(db, s)).status, (await current(db, s)).errorCode], ["in_meeting", null]);
});

test("start_failed (the engine sent no bot) never changes", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await db.setSessionStart("org_a", s.id, { kind: "rejected", errorCode: "recall_rejected" });
  await withServer(server, async (base) => {
    for (const status of ["joining", "in_meeting", "ended", "failed"] as const) {
      assert.deepEqual(await (await post(base, statusEvent(s, status))).json(), { applied: false });
    }
  });
  assert.deepEqual([(await current(db, s)).status, (await current(db, s)).errorCode], ["start_failed", "recall_rejected"]);
});

test("another org's session, or one that doesn't exist, is 404 and doesn't change", async () => {
  const { db, server } = await api();
  const theirs = await startedSession(db, "org_b");
  await withServer(server, async (base) => {
    const res = await post(base, statusEvent(theirs, "ended"));
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "session_not_found");
    assert.equal((await post(base, statusEvent({ id: randomUUID() }, "ended"))).status, 404);
    assert.equal((await post(base, statusEvent({ id: "not-a-uuid" }, "ended"))).status, 404);
  });
  assert.equal((await current(db, theirs, "org_b")).status, "starting");
});

test("an ended session stops holding its meeting link and its place in the limits at once", async () => {
  const { db, server } = await api();
  await db.upsertOrg("org_a");
  const meetingUrl = newMeeting();
  const first = (await db.createSessionUnlessActive("org_a", { id: randomUUID(), createdBy: "user_1", meetingUrl, limits: LIMITS })).session;
  await db.setSessionStart("org_a", first.id, { kind: "ok", status: "joining", stageUrl: "https://engine.example.com/stage/x" });
  const again = await db.createSessionUnlessActive("org_a", { id: randomUUID(), createdBy: "user_1", meetingUrl, limits: LIMITS });
  assert.equal(again.reused, true, "still active: reused");
  await withServer(server, async (base) => { await post(base, statusEvent(first, "ended")); });
  const fresh = await db.createSessionUnlessActive("org_a", { id: randomUUID(), createdBy: "user_1", meetingUrl, limits: LIMITS });
  assert.equal(fresh.reused, false, "ended: a new start sends a new bot");
  // With one active place per org, the ended one no longer counts.
  const limits = { maxActive: 1, maxPerDay: 20, maxActivePerUser: 5, maxPerUserPerDay: 20, activeMarginMinutes: 30 };
  await withServer(server, async (base) => { await post(base, statusEvent(fresh.session, "failed")); });
  await assert.doesNotReject(db.createSessionUnlessActive("org_a", { id: randomUUID(), createdBy: "user_1", meetingUrl: newMeeting(), limits: LIMITS }, limits));
});

test("without a database, a status event is 503 so the engine tries again", async () => {
  const { server } = await api({ db: null });
  await withServer(server, async (base) => {
    const res = await post(base, statusEvent({ id: randomUUID() }, "joining"));
    assert.equal(res.status, 503);
  });
});

test("logs carry ids, the status and the outcome only", async () => {
  const { db, server, logs } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => {
    await post(base, statusEvent(s, "in_meeting"));
    await post(base, statusEvent(s, "joining"));
  });
  const lines = logs.filter((l) => l.msg === "engine_event.status");
  assert.deepEqual(lines.map((l) => l.fields), [
    { session_id: s.id, org_id: "org_a", status: "in_meeting", outcome: "applied" },
    { session_id: s.id, org_id: "org_a", status: "joining", outcome: "stale" },
  ]);
  assert.ok(!JSON.stringify(logs).includes("meet.google.com") && !JSON.stringify(logs).includes(TOKEN));
});

// ---- the start answer arriving after an event ----

test("an event before the start answer is saved: the status stays, and the stage link is still saved", async () => {
  const { db, server } = await api();
  const s = await startedSession(db);
  await withServer(server, async (base) => { await post(base, statusEvent(s, "in_meeting")); });
  const saved = await db.setSessionStart("org_a", s.id, { kind: "ok", status: "joining", stageUrl: "https://engine.example.com/stage/1" });
  assert.deepEqual([saved?.status, saved?.stageUrl], ["in_meeting", "https://engine.example.com/stage/1"]);
  assert.equal(await db.setSessionStart("org_a", s.id, { kind: "ok", status: "joining", stageUrl: "https://engine.example.com/stage/2" }), undefined, "only once");
  assert.equal((await current(db, s)).stageUrl, "https://engine.example.com/stage/1");
});

test("an event before an unclear or refused start answer: the event's status stays", async () => {
  const { db, server } = await api();
  const a = await startedSession(db), b = await startedSession(db);
  await withServer(server, async (base) => {
    await post(base, statusEvent(a, "in_meeting"));
    await post(base, statusEvent(b, "ended"));
  });
  assert.equal(await db.setSessionStart("org_a", a.id, { kind: "unknown", errorCode: "timeout" }), undefined);
  assert.equal(await db.setSessionStart("org_a", b.id, { kind: "rejected", errorCode: "recall_rejected" }), undefined);
  assert.deepEqual([(await current(db, a)).status, (await current(db, a)).errorCode], ["in_meeting", null]);
  assert.equal((await current(db, b)).status, "ended");
});

test("applyStatusEvent in the database: forward only, within the org", async () => {
  const db = await testDb();
  const s = await startedSession(db);
  assert.equal(await db.applyStatusEvent("org_b", s.id, "joining", null), "not_found");
  assert.equal(await db.applyStatusEvent("org_a", randomUUID(), "joining", null), "not_found");
  assert.equal(await db.applyStatusEvent("org_a", s.id, "in_meeting", null), "applied");
  assert.equal(await db.applyStatusEvent("org_a", s.id, "joining", null), "stale");
  assert.equal(await db.applyStatusEvent("org_a", s.id, "failed", "fatal_x"), "applied");
  assert.equal(await db.applyStatusEvent("org_a", s.id, "ended", null), "stale");
  assert.deepEqual([(await current(db, s)).status, (await current(db, s)).errorCode], ["failed", "fatal_x"]);
});
