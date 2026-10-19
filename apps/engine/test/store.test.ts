// The SurrealDB store (docs/adr/0011-surrealdb.md), run in this process: what the old synchronous SQLite store
// guaranteed by running one call at a time must still hold when calls overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordId } from "surrealdb";
import { connect, query } from "../src/db/connect.ts";
import { testStore } from "./helpers/store.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import { emptyPrototype, UNTITLED_APP } from "../src/ui/tree.ts";

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const tmpDir = () => join(mkdtempSync(join(tmpdir(), "engine-surreal-")), "surreal");
// Writes to a store's folder behind its back, as older code or a bug might have. The store must be closed.
async function raw(path: string, sql: string, vars: Record<string, unknown>) {
  const db = await connect({ path });
  try {
    await db.query(sql, vars).collect();
  } finally {
    await db.close();
  }
}

test("the same Recall event delivered twice at once is stored once", async () => {
  const store = await testStore();
  const id = "11111111-1111-1111-1111-111111111111";
  await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  const e = { sessionId: id, recallMsgId: "msg-1", kind: "utterance", speaker: "Ada", text: "hello" };
  const results = await Promise.all(Array.from({ length: 8 }, () => store.addEvent(e)));
  assert.equal(results.filter((r) => r !== null).length, 1, "one delivery wins, the others read as duplicates");
  assert.equal((await store.listEvents(id)).length, 1);
  // Our own lines carry no Recall id and never clash with each other.
  const own = { ...e, recallMsgId: null, kind: "bot_chat" };
  assert.ok(await store.addEvent(own));
  assert.ok(await store.addEvent(own));
  assert.equal((await store.listEvents(id)).length, 3);
  await store.close();
});

test("events read back in the order they were stored, with ISO timestamps", async () => {
  const store = await testStore();
  const id = "22222222-2222-2222-2222-222222222222";
  const s = await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  assert.equal(s.state, "intent");
  assert.match(s.created_at, ISO);
  const stored = [];
  for (const text of ["one", "two", "three"]) stored.push((await store.addEvent({ sessionId: id, recallMsgId: null, kind: "utterance", speaker: "Ada", text }))!);
  assert.deepEqual(Object.keys(stored[0]).sort(), ["created_at", "id", "kind", "session_id", "speaker", "text"]);
  assert.equal(typeof stored[0].id, "number");
  assert.match(stored[0].created_at, ISO);
  assert.deepEqual((await store.listEvents(id)).map((e) => e.text), ["one", "two", "three"]);
  assert.deepEqual((await store.recentUtterances(id, 2)).map((e) => e.text), ["two", "three"]);
  await store.close();
});

test("an event for a session that doesn't exist is refused", async () => {
  const store = await testStore();
  await assert.rejects(store.addEvent({ sessionId: "nope", recallMsgId: null, kind: "utterance", speaker: null, text: null }));
  await assert.rejects(store.addEvent({ sessionId: "nope", recallMsgId: "m-nope", kind: "utterance", speaker: null, text: null }));
  assert.deepEqual(await store.listEvents("nope"), [], "nothing was stored");
  await store.close();
});

test("a session's bot id is unique", async () => {
  const store = await testStore();
  await store.createIntent("a", "https://meet.google.com/a");
  await store.createIntent("b", "https://meet.google.com/b");
  await store.markCreated("a", "bot-1");
  await assert.rejects(store.markCreated("b", "bot-1"));
  assert.equal((await store.getSessionByBotId("bot-1"))?.id, "a");
  await store.close();
});

test("a missing stage or handoff token is issued once, even when asked for twice at the same time", async () => {
  const path = tmpDir();
  const store = await testStore({ path });
  const id = "44444444-4444-4444-4444-444444444444";
  await store.createIntent(id, "https://meet.google.com/x");
  await store.close();
  // A row from before tokens were issued at creation.
  await raw(path, "UPDATE $id SET stage_token = NONE, handoff_token = NONE", { id: new RecordId("sessions", id) });

  const again = await testStore({ path });
  assert.equal((await again.getSession(id))?.stage_token, null, "an absent token reads as null");
  const stage = await Promise.all([again.ensureStageToken(id), again.ensureStageToken(id)]);
  assert.ok(stage[0].length >= 32);
  assert.equal(stage[1], stage[0], "both callers get the one token");
  const handoff = await Promise.all([again.ensureHandoffToken(id), again.ensureHandoffToken(id)]);
  assert.equal(handoff[1], handoff[0]);
  assert.notEqual(handoff[0], stage[0], "the handoff token is not the stage token");
  assert.equal(await again.ensureStageToken(id), stage[0], "stable once issued");
  assert.equal((await again.getSession(id))?.stage_token, stage[0]);
  await again.close();
});

test("a SurrealKV folder keeps sessions, events, consensus and cost across a restart", async () => {
  const path = tmpDir();
  const id = "55555555-5555-5555-5555-555555555555";
  const first = await testStore({ path });
  await first.createIntent(id, "https://meet.google.com/x");
  await first.markCreated(id, "bot-5");
  await first.updateBotStatus(id, "in_call_recording", null);
  await first.addEvent({ sessionId: id, recallMsgId: "m1", kind: "utterance", speaker: "Ada", text: "hi" });
  const doc = emptyDoc();
  const proto = emptyPrototype(UNTITLED_APP);
  await first.saveConsensus(id, doc, proto);
  await first.addModelCall({ sessionId: id, loop: "build", model: "m", inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.25, ms: 12.6 });
  await first.addModelCall({ sessionId: id, loop: "conversation", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.5, ms: 3 });
  await first.close();

  const second = await testStore({ path }); // migrating an up-to-date database again is a no-op
  assert.deepEqual((await second.listActiveSessions()).map((s) => s.id), [id]);
  assert.equal((await second.findActiveForMeeting("https://meet.google.com/x"))?.bot_id, "bot-5");
  assert.equal(await second.addEvent({ sessionId: id, recallMsgId: "m1", kind: "utterance", speaker: "Ada", text: "hi" }), null, "still a duplicate");
  assert.deepEqual(await second.getConsensus(id), { doc, proto });
  assert.equal(await second.sessionCost(id), 0.75);
  assert.equal(await second.sessionCost("other"), 0);
  const calls = await second.listModelCalls(id);
  assert.deepEqual(calls.map((c) => [c.loop, c.ms]), [["build", 13], ["conversation", 3]]);
  assert.match(calls[0].created_at, ISO);
  await second.close();
});

test("a stored consensus row that no longer parses reads as absent instead of throwing", async () => {
  const path = tmpDir();
  const id = "33333333-3333-3333-3333-333333333333";
  const first = await testStore({ path });
  await first.createIntent(id, "https://meet.google.com/x");
  await first.close();
  await raw(path, "CREATE $id SET doc_json = $doc, proto_json = $proto, updated_at = time::now()",
    { id: new RecordId("consensus", id), doc: '{"old":"shape"}', proto: "not json" });

  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const store = await testStore({ path, log: (msg, fields) => logs.push({ msg, fields }) });
  assert.equal(await store.getConsensus(id), undefined);
  assert.deepEqual(logs, [{ msg: "store.consensus_invalid", fields: { session_id: id, doc_ok: false, proto_ok: false } }]);
  await store.close();
});

test("in-memory stores are separate databases", async () => {
  const a = await testStore();
  const b = await testStore();
  await a.createIntent("x", "https://meet.google.com/x");
  assert.equal(await b.getSession("x"), undefined);
  await Promise.all([a.close(), b.close()]);
});

// ---- E4 and E3 (docs/plans/api-first-slice.md): sessions belong to an org, and reuse stays within it ----

test("E4: a session saved before 0002 still reads after it, with no org and no limits", async () => {
  const { copyFileSync, mkdirSync } = await import("node:fs");
  const { migrate, MIGRATIONS_DIR } = await import("../src/db/migrate.ts");
  const path = tmpDir();
  const only0001 = join(mkdtempSync(join(tmpdir(), "engine-0001-")), "db");
  mkdirSync(only0001);
  copyFileSync(join(MIGRATIONS_DIR, "0001_init.surql"), join(only0001, "0001_init.surql"));
  const db = await connect({ path });
  try {
    await migrate(db, only0001);
    await db.query("CREATE $id CONTENT { meeting_url: 'https://meet.google.com/old', state: 'created', created_at: time::now(), updated_at: time::now() }",
      { id: new RecordId("sessions", "11111111-1111-1111-1111-111111111111") }).collect();
  } finally {
    await db.close();
  }
  const store = await testStore({ path });
  const s = await store.getSession("11111111-1111-1111-1111-111111111111");
  assert.deepEqual([s?.org_id, s?.max_usd, s?.max_minutes], [null, null, null]);
  assert.equal((await store.findActiveForMeeting("https://meet.google.com/old"))?.id, s?.id, "still the operator's to reuse");
  await store.close();
});

test("E4: createIntent saves the org and its limits when given them, and the schema checks their types", async () => {
  const store = await testStore();
  const s = await store.createIntent("22222222-2222-2222-2222-222222222222", "https://meet.google.com/x", { orgId: "org_a", maxUsd: 2.5, maxMinutes: 30 });
  assert.deepEqual([s.org_id, s.max_usd, s.max_minutes], ["org_a", 2.5, 30]);
  const plain = await store.createIntent("33333333-3333-3333-3333-333333333333", "https://meet.google.com/y");
  assert.deepEqual([plain.org_id, plain.max_usd, plain.max_minutes], [null, null, null]);
  await assert.rejects(store.createIntent("44444444-4444-4444-4444-444444444444", "https://meet.google.com/z",
    { orgId: "org_a", maxUsd: "lots" as unknown as number, maxMinutes: 30 }));
});

test("E3: findActiveForMeeting only finds the given org's sessions; no org finds only sessions without one", async () => {
  const store = await testStore();
  const url = "https://meet.google.com/sha-redm-eet";
  const limits = { maxUsd: 5, maxMinutes: 60 };
  const a = await store.createIntent("aaaaaaaa-0000-4000-8000-000000000001", url, { orgId: "org_a", ...limits });
  assert.equal((await store.findActiveForMeeting(url, "org_a"))?.id, a.id);
  assert.equal(await store.findActiveForMeeting(url, "org_b"), undefined, "never another org's session");
  assert.equal(await store.findActiveForMeeting(url), undefined, "nor an org's session for the operator");
  const op = await store.createIntent("aaaaaaaa-0000-4000-8000-000000000002", url);
  assert.equal((await store.findActiveForMeeting(url))?.id, op.id);
  assert.equal((await store.findActiveForMeeting(url, "org_a"))?.id, a.id, "nor the operator's session for an org");
});

test("R4: a store query that takes longer than its deadline fails with STORE_TIMEOUT instead of waiting", async () => {
  const db = await connect();
  try {
    const t0 = Date.now();
    await assert.rejects(query(db, "SLEEP 2s", {}, 50), (err: Error & { code?: string }) => err.code === "STORE_TIMEOUT");
    assert.ok(Date.now() - t0 < 1000, "gave up at the deadline, not when the statement ended");
    const [n] = await query<[number]>(db, "RETURN 1 + 1", {}, 1000);
    assert.equal(n, 2, "a query inside its deadline answers as usual");
  } finally {
    await db.close();
  }
});

test("R3: close waits for the writes already asked for, so a shutdown doesn't lose them", async () => {
  const path = tmpDir();
  const id = "77777777-7777-7777-7777-777777777777";
  const first = await testStore({ path });
  await first.createIntent(id, "https://meet.google.com/x");
  const doc = emptyDoc();
  const proto = emptyPrototype(UNTITLED_APP);
  // Not awaited, as a write still in flight when SIGTERM arrives.
  const writes = [
    first.addEvent({ sessionId: id, recallMsgId: "m1", kind: "utterance", speaker: "Ada", text: "hi" }),
    first.saveConsensus(id, doc, proto),
    first.addModelCall({ sessionId: id, loop: "build", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.25, ms: 1 }),
  ];
  await first.close();
  await Promise.all(writes);

  const second = await testStore({ path });
  assert.equal((await second.listEvents(id)).length, 1);
  assert.deepEqual(await second.getConsensus(id), { doc, proto });
  assert.equal(await second.sessionCost(id), 0.25);
  await second.close();
});
