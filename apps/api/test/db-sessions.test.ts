// The api's db functions (src/db/), on in-memory SurrealDB. Tenant isolation (ADR 0006) is the main thing: no
// function returns or changes another org's sessions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { rawDb, testDb } from "./helpers/db.ts";
import { upsertOrg } from "../src/db/orgs.ts";
import { createSessionUnlessActive } from "../src/db/sessions.ts";
import { StartLimitError } from "../src/db/index.ts";
import type { NewSession } from "../src/db/index.ts";
import { errorCode } from "../src/error-code.ts";

const MEET = "https://meet.google.com/abc-defg-hij";
const limits = { maxUsd: 5, maxMinutes: 60 };
const newSession = (over: Partial<NewSession> = {}): NewSession => ({ id: randomUUID(), createdBy: "user_1", meetingUrl: MEET, limits, ...over });
// For tests of other things: limits that never get in the way.
const ROOMY = { maxActive: 1000, maxPerDay: 1000, maxActivePerUser: 1000, maxPerUserPerDay: 1000, activeMarginMinutes: 10 };
const lim = (over: Partial<typeof ROOMY>) => ({ ...ROOMY, ...over });
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("upsertOrg is safe to repeat and keeps the org's first created_at", async () => {
  const raw = await rawDb();
  await upsertOrg(raw, "org_A");
  const [[first]] = await raw.query<[unknown[]]>("SELECT VALUE created_at FROM org:org_A").collect();
  await upsertOrg(raw, "org_A");
  await upsertOrg(raw, "org_B");
  const [ids] = await raw.query<[string[]]>("SELECT VALUE record::id(id) FROM org ORDER BY id").collect();
  assert.deepEqual(ids, ["org_A", "org_B"]);
  const [[again]] = await raw.query<[unknown[]]>("SELECT VALUE created_at FROM org:org_A").collect();
  assert.deepEqual(again, first);
});

test("a new session is created as starting, with the org's row, and comes back as a plain object", async () => {
  const db = await testDb();
  const s = newSession();
  const { session, reused } = await db.createSessionUnlessActive("org_A", s);
  assert.equal(reused, false);
  assert.deepEqual({ ...session, createdAt: "", updatedAt: "" }, {
    id: s.id, createdBy: "user_1", meetingUrl: MEET, status: "starting", errorCode: null, stageUrl: null, limits, createdAt: "", updatedAt: "",
  });
  assert.match(session.createdAt, ISO);
  assert.match(session.updatedAt, ISO);
  assert.deepEqual(JSON.parse(JSON.stringify(session)), session, "no SDK types, only JSON values");
  assert.deepEqual(await db.getSession("org_A", s.id), session);
});

test("get and list never return another org's sessions", async () => {
  const db = await testDb();
  const a = (await db.createSessionUnlessActive("org_A", newSession())).session;
  const b = (await db.createSessionUnlessActive("org_B", newSession())).session;
  assert.equal(await db.getSession("org_B", a.id), undefined, "another org's id looks like a missing one");
  assert.equal(await db.getSession("org_A", randomUUID()), undefined);
  assert.equal(await db.getSession("org_A", ""), undefined);
  assert.deepEqual((await db.listSessions("org_A")).map((s) => s.id), [a.id]);
  assert.deepEqual((await db.listSessions("org_B")).map((s) => s.id), [b.id]);
  assert.deepEqual(await db.listSessions("org_C"), []);
});

test("list is newest first and capped at 50", async () => {
  const db = await testDb();
  const ids: string[] = [];
  for (let i = 0; i < 53; i++) ids.push((await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}?n=${i}` }), ROOMY)).session.id);
  const all = await db.listSessions("org_A");
  assert.equal(all.length, 50);
  assert.deepEqual(all.map((s) => s.id), ids.slice(-50).reverse());
  assert.deepEqual((await db.listSessions("org_A", 3)).map((s) => s.id), ids.slice(-3).reverse());
  assert.equal((await db.listSessions("org_A", 500)).length, 50);
  assert.equal((await db.listSessions("org_A", 0)).length, 1);
  assert.equal((await db.listSessions("org_A", Number.NaN)).length, 50);
});

test("an active session for the same org and meeting is reused, not started again (D7)", async () => {
  const db = await testDb();
  const first = (await db.createSessionUnlessActive("org_A", newSession(), ROOMY)).session;
  const second = await db.createSessionUnlessActive("org_A", newSession({ createdBy: "user_2" }), ROOMY);
  assert.equal(second.reused, true);
  assert.equal(second.session.id, first.id);
  assert.equal(second.session.createdBy, "user_1", "the existing session, unchanged");
  assert.equal((await db.createSessionUnlessActive("org_B", newSession(), ROOMY)).reused, false, "another org's session is never reused");
  assert.equal((await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}x` }), ROOMY)).reused, false, "another meeting isn't either");
  assert.equal((await db.listSessions("org_A")).length, 2);
});

test("joining and in_meeting sessions are reused; finished and failed ones are not", async () => {
  const raw = await rawDb();
  const cases: [string, boolean][] = [
    ["joining", true], ["in_meeting", true], ["ended", false], ["failed", false], ["start_failed", false], ["start_unknown", false],
  ];
  for (const [status, reusedExpected] of cases) {
    const url = `${MEET}?status=${status}`;
    const first = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: url }), ROOMY);
    // Routes move the status on through setSessionStart, and later engine events do. Here it's set directly.
    await raw.query("UPDATE $id SET status = $status", { id: new RecordId("session", first.session.id), status }).collect();
    const again = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: url }), ROOMY);
    assert.equal(again.reused, reusedExpected, status);
  }
});

test("eight starts at once for the same meeting make one session", async () => {
  const db = await testDb();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => db.createSessionUnlessActive("org_A", newSession({ createdBy: `user_${i}` }))));
  const ids = new Set(results.map((r) => r.session.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((r) => !r.reused).length, 1, "exactly one of them created it");
  assert.equal((await db.listSessions("org_A")).length, 1);
});

test("setSessionStart records the engine's answer once, and only in the session's own org", async () => {
  const db = await testDb();
  const ok = (await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}?ok` }))).session;
  assert.equal(await db.setSessionStart("org_B", ok.id, { kind: "ok", status: "joining", stageUrl: "https://stage.example.com/x" }), undefined,
    "another org can't change it");
  const started = await db.setSessionStart("org_A", ok.id, { kind: "ok", status: "joining", stageUrl: "https://stage.example.com/x" });
  assert.equal(started?.status, "joining");
  assert.equal(started?.stageUrl, "https://stage.example.com/x");
  assert.equal(started?.errorCode, null);
  assert.equal(await db.setSessionStart("org_A", ok.id, { kind: "unknown" }), undefined, "only a starting session changes");
  assert.equal((await db.getSession("org_A", ok.id))?.status, "joining");

  const no = (await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}?no` }))).session;
  const failed = await db.setSessionStart("org_A", no.id, { kind: "rejected", errorCode: "recall_rejected" });
  assert.deepEqual([failed?.status, failed?.errorCode, failed?.stageUrl], ["start_failed", "recall_rejected", null]);

  const maybe = (await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}?maybe` }))).session;
  const unknown = await db.setSessionStart("org_A", maybe.id, { kind: "unknown", errorCode: "timeout" });
  assert.deepEqual([unknown?.status, unknown?.errorCode], ["start_unknown", "timeout"]);
  assert.equal(await db.setSessionStart("org_A", randomUUID(), { kind: "unknown" }), undefined);
});

test("the schema refuses an unknown status and a duplicate session id", async () => {
  const raw = await rawDb();
  const row = { org: new RecordId("org", "org_A"), created_by: "u", meeting_url: MEET, max_usd: 1, max_minutes: 1 };
  await assert.rejects(raw.query("CREATE session CONTENT $row", { row: { ...row, status: "bogus" } }).collect());
  const db = await testDb();
  const s = newSession();
  await db.createSessionUnlessActive("org_A", s);
  await assert.rejects(db.createSessionUnlessActive("org_A", { ...s, meetingUrl: `${MEET}?other` }), (err) => errorCode(err) === "AlreadyExists.Record");
});

test("the schema allows one active session per org and meeting, whatever the code does", async () => {
  const raw = await rawDb();
  const row = (org: string, status: string) =>
    ({ org: new RecordId("org", org), created_by: "u", meeting_url: MEET, status, max_usd: 1, max_minutes: 1 });
  const create = (org: string, status: string) => raw.query("CREATE session CONTENT $row", { row: row(org, status) }).collect();
  await create("org_A", "starting");
  await assert.rejects(create("org_A", "joining"), "a second active one is refused by the unique index");
  await create("org_B", "starting");
  await create("org_A", "ended");
  await create("org_A", "failed");
  const [ids] = await raw.query<[unknown[]]>("SELECT VALUE id FROM session").collect();
  assert.equal(ids.length, 4, "finished sessions don't count against it");
});

// ---- start guards (db/0002_start_guards.surql) ----

const sessionId = (id: string) => new RecordId("session", id);
const refused = (limit: "active" | "daily" | "user_active" | "user_daily") => (err: unknown) => err instanceof StartLimitError && err.limit === limit;

test("an org may have at most maxActive active sessions; reusing one still works at the limit, and a finished one frees a place", async () => {
  const raw = await rawDb();
  const limits = lim({ maxActive: 2, maxPerDay: 100, activeMarginMinutes: 10 });
  const a = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?a` }), limits);
  await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?b` }), limits);
  await assert.rejects(createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?c` }), limits), refused("active"));
  const [count] = await raw.query<[number]>("RETURN count(SELECT VALUE id FROM session)").collect();
  assert.equal(count, 2, "a refused start saves nothing");
  assert.equal((await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?a` }), limits)).reused, true);
  assert.equal((await createSessionUnlessActive(raw, "org_B", newSession({ meetingUrl: `${MEET}?c` }), limits)).reused, false, "another org has its own");
  await raw.query("UPDATE $id SET status = 'ended'", { id: sessionId(a.session.id) }).collect();
  assert.equal((await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?c` }), limits)).reused, false);
});

test("an org may start at most maxPerDay sessions in 24 hours, finished or not; older ones don't count", async () => {
  const raw = await rawDb();
  const limits = lim({ maxActive: 100, maxPerDay: 3, activeMarginMinutes: 10 });
  // One from two days ago.
  await raw.query("CREATE session CONTENT $row", { row: { org: new RecordId("org", "org_A"), created_by: "u", meeting_url: `${MEET}?old`, status: "ended", max_usd: 1, max_minutes: 1, created_at: new Date(Date.now() - 2 * 86_400_000) } }).collect();
  for (const n of [1, 2, 3]) {
    const { session } = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?${n}` }), limits);
    await raw.query("UPDATE $id SET status = 'start_failed'", { id: sessionId(session.id) }).collect();
  }
  await assert.rejects(createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?4` }), limits), refused("daily"));
  assert.equal((await createSessionUnlessActive(raw, "org_B", newSession({ meetingUrl: `${MEET}?4` }), limits)).reused, false);
});

test("a new session is active until its time limit plus the margin", async () => {
  const raw = await rawDb();
  const { session } = await createSessionUnlessActive(raw, "org_A", newSession({ limits: { maxUsd: 5, maxMinutes: 30 } }), { ...ROOMY, activeMarginMinutes: 7 });
  const [[row]] = await raw.query<[{ created_at: { toDate(): Date }; active_until: { toDate(): Date } }[]]>(
    "SELECT created_at, active_until FROM $id", { id: sessionId(session.id) }).collect();
  assert.equal(row!.active_until.toDate().getTime() - row!.created_at.toDate().getTime(), 37 * 60_000);
});

test("a session past its active_until stops blocking its meeting (statuses don't move yet) and stops counting", async () => {
  const raw = await rawDb();
  const limits = lim({ maxActive: 1, maxPerDay: 100, activeMarginMinutes: 10 });
  const first = await createSessionUnlessActive(raw, "org_A", newSession(), limits);
  await raw.query("UPDATE $id SET status = 'joining', active_until = time::now() - 1s", { id: sessionId(first.session.id) }).collect();
  const again = await createSessionUnlessActive(raw, "org_A", newSession(), limits);
  assert.equal(again.reused, false, "a new session for the same link, not the stale one");
  assert.notEqual(again.session.id, first.session.id);
  const [[stale]] = await raw.query<[{ status: string; active_meeting?: string }[]]>("SELECT status, active_meeting FROM $id", { id: sessionId(first.session.id) }).collect();
  assert.equal(stale!.status, "joining", "its status is left as it was");
  assert.equal(stale!.active_meeting, undefined);
});

test("a session from before the stopgap (no active_until) gets one from its created_at and time limit", async () => {
  const raw = await rawDb();
  const old = { org: new RecordId("org", "org_A"), created_by: "u", meeting_url: MEET, status: "joining", max_usd: 1, max_minutes: 60 };
  await raw.query("CREATE session:old CONTENT $row", { row: { ...old, created_at: new Date(Date.now() - 3 * 3_600_000) } }).collect();
  await raw.query("CREATE session:recent CONTENT $row", { row: { ...old, meeting_url: `${MEET}?recent`, created_at: new Date(Date.now() - 5 * 60_000) } }).collect();
  assert.equal((await createSessionUnlessActive(raw, "org_A", newSession(), ROOMY)).reused, false, "3 hours old with a 60-minute limit: expired");
  assert.equal((await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?recent` }), ROOMY)).reused, true, "5 minutes old: still active");
});

test("eight starts at once for different meetings stay within maxActive", async () => {
  const db = await testDb();
  const limits = lim({ maxActive: 2, maxPerDay: 100, activeMarginMinutes: 10 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}?p=${i}` }), limits)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => refused("active")((r as PromiseRejectedResult).reason)));
  assert.equal((await db.listSessions("org_A")).length, 2);
});

test("a person may have at most maxActivePerUser active sessions across every org, so making orgs gets no more", async () => {
  const raw = await rawDb();
  const limits = lim({ maxActivePerUser: 2 });
  await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?1` }), limits);
  await createSessionUnlessActive(raw, "org_B", newSession({ meetingUrl: `${MEET}?2` }), limits);
  await assert.rejects(createSessionUnlessActive(raw, "org_C", newSession({ meetingUrl: `${MEET}?3` }), limits), refused("user_active"));
  assert.equal((await createSessionUnlessActive(raw, "org_C", newSession({ meetingUrl: `${MEET}?3`, createdBy: "user_2" }), limits)).reused, false,
    "someone else in that org isn't held back");
});

test("a person may start at most maxPerUserPerDay sessions in 24 hours across every org", async () => {
  const raw = await rawDb();
  const limits = lim({ maxPerUserPerDay: 2 });
  for (const org of ["org_A", "org_B"]) {
    const { session } = await createSessionUnlessActive(raw, org, newSession({ meetingUrl: `${MEET}?${org}` }), limits);
    await raw.query("UPDATE $id SET status = 'ended'", { id: sessionId(session.id) }).collect();
  }
  await assert.rejects(createSessionUnlessActive(raw, "org_C", newSession(), limits), refused("user_daily"));
});

test("an unconfirmed start (start_unknown) still holds its place until it expires: a bot may exist", async () => {
  const raw = await rawDb();
  const limits = lim({ maxActive: 1 });
  const first = await createSessionUnlessActive(raw, "org_A", newSession(), limits);
  await raw.query("UPDATE $id SET status = 'start_unknown'", { id: sessionId(first.session.id) }).collect();
  await assert.rejects(createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?other` }), limits), refused("active"));
  await raw.query("UPDATE $id SET active_until = time::now() - 1s", { id: sessionId(first.session.id) }).collect();
  assert.equal((await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?other` }), limits)).reused, false);
});

test("at the daily limit, the same meeting is still reused: nothing new starts", async () => {
  const raw = await rawDb();
  const limits = lim({ maxPerDay: 1, maxPerUserPerDay: 1 });
  const first = await createSessionUnlessActive(raw, "org_A", newSession(), limits);
  const again = await createSessionUnlessActive(raw, "org_A", newSession(), limits);
  assert.deepEqual([again.reused, again.session.id], [true, first.session.id]);
});

test("a session that runs past its active_until on its own is freed by the next start; the others keep their updated_at", async () => {
  const raw = await rawDb();
  const first = await createSessionUnlessActive(raw, "org_A", newSession(), ROOMY);
  const other = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: `${MEET}?other` }), ROOMY);
  await raw.query("UPDATE $id SET status = 'joining', active_until = time::now() + 1s", { id: sessionId(first.session.id) }).collect();
  const before = (await raw.query<[{ updated_at: { toDate(): Date } }[]]>("SELECT updated_at FROM $id", { id: sessionId(other.session.id) }).collect())[0][0]!.updated_at.toDate();
  await new Promise((r) => setTimeout(r, 1_200));
  // Nothing wrote the first row since it expired: the start's own rewrite drops it out of active_meeting.
  const again = await createSessionUnlessActive(raw, "org_A", newSession(), ROOMY);
  assert.equal(again.reused, false);
  const after = (await raw.query<[{ updated_at: { toDate(): Date } }[]]>("SELECT updated_at FROM $id", { id: sessionId(other.session.id) }).collect())[0][0]!.updated_at.toDate();
  assert.equal(after.getTime(), before.getTime(), "an active session that isn't expired isn't rewritten");
});

test("eight starts at once by one person in eight orgs stay within maxActivePerUser", async () => {
  const db = await testDb();
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    db.createSessionUnlessActive(`org_${i}`, newSession({ meetingUrl: `${MEET}?p=${i}` }), lim({ maxActivePerUser: 2 }))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => refused("user_active")((r as PromiseRejectedResult).reason)));
});
