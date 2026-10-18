// The api's db functions (src/db/), on in-memory SurrealDB. Tenant isolation (ADR 0006) is the main thing: no
// function returns or changes another org's sessions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RecordId } from "surrealdb";
import { rawDb, testDb } from "./helpers/db.ts";
import { upsertOrg } from "../src/db/orgs.ts";
import { createSessionUnlessActive } from "../src/db/sessions.ts";
import type { NewSession } from "../src/db/index.ts";
import { errorCode } from "../src/error-code.ts";

const MEET = "https://meet.google.com/abc-defg-hij";
const limits = { maxUsd: 5, maxMinutes: 60 };
const newSession = (over: Partial<NewSession> = {}): NewSession => ({ id: randomUUID(), createdBy: "user_1", meetingUrl: MEET, limits, ...over });
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
  for (let i = 0; i < 53; i++) ids.push((await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}?n=${i}` }))).session.id);
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
  const first = (await db.createSessionUnlessActive("org_A", newSession())).session;
  const second = await db.createSessionUnlessActive("org_A", newSession({ createdBy: "user_2" }));
  assert.equal(second.reused, true);
  assert.equal(second.session.id, first.id);
  assert.equal(second.session.createdBy, "user_1", "the existing session, unchanged");
  assert.equal((await db.createSessionUnlessActive("org_B", newSession())).reused, false, "another org's session is never reused");
  assert.equal((await db.createSessionUnlessActive("org_A", newSession({ meetingUrl: `${MEET}x` }))).reused, false, "another meeting isn't either");
  assert.equal((await db.listSessions("org_A")).length, 2);
});

test("joining and in_meeting sessions are reused; finished and failed ones are not", async () => {
  const raw = await rawDb();
  const cases: [string, boolean][] = [
    ["joining", true], ["in_meeting", true], ["ended", false], ["failed", false], ["start_failed", false], ["start_unknown", false],
  ];
  for (const [status, reusedExpected] of cases) {
    const url = `${MEET}?status=${status}`;
    const first = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: url }));
    // Routes move the status on through setSessionStart, and later engine events do. Here it's set directly.
    await raw.query("UPDATE $id SET status = $status", { id: new RecordId("session", first.session.id), status }).collect();
    const again = await createSessionUnlessActive(raw, "org_A", newSession({ meetingUrl: url }));
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
