// The Postgres store (docs/adr/0007-database.md), run on PGlite: what the old synchronous SQLite store
// guaranteed by running one call at a time must still hold when calls overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { openStore } from "../src/store.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import { emptyPrototype, UNTITLED_APP } from "../src/ui/tree.ts";

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const tmpDir = () => join(mkdtempSync(join(tmpdir(), "engine-pg-")), "pg");

test("the same Recall event delivered twice at once is stored once", async () => {
  const store = await openStore();
  const id = "11111111-1111-1111-1111-111111111111";
  await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  const e = { sessionId: id, recallMsgId: "msg-1", kind: "utterance", speaker: "Ada", text: "hello" };
  const results = await Promise.all([store.addEvent(e), store.addEvent(e), store.addEvent(e)]);
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
  const store = await openStore();
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
  const store = await openStore();
  await assert.rejects(store.addEvent({ sessionId: "nope", recallMsgId: null, kind: "utterance", speaker: null, text: null }));
  await store.close();
});

test("a session's bot id is unique", async () => {
  const store = await openStore();
  await store.createIntent("a", "https://meet.google.com/a");
  await store.createIntent("b", "https://meet.google.com/b");
  await store.markCreated("a", "bot-1");
  await assert.rejects(store.markCreated("b", "bot-1"));
  assert.equal((await store.getSessionByBotId("bot-1"))?.id, "a");
  await store.close();
});

test("a missing stage or handoff token is issued once, even when asked for twice at the same time", async () => {
  const dataDir = tmpDir();
  const store = await openStore({ dataDir });
  const id = "44444444-4444-4444-4444-444444444444";
  await store.createIntent(id, "https://meet.google.com/x");
  await store.close();
  // A row from before tokens were issued at creation.
  const raw = new PGlite(dataDir);
  await raw.query(`UPDATE engine.sessions SET stage_token = NULL, handoff_token = NULL WHERE id = $1`, [id]);
  await raw.close();

  const again = await openStore({ dataDir });
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

test("a data directory keeps sessions, events, consensus and cost across a restart", async () => {
  const dataDir = tmpDir();
  const id = "55555555-5555-5555-5555-555555555555";
  const first = await openStore({ dataDir });
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

  const second = await openStore({ dataDir }); // migrating an up-to-date database again is a no-op
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
  const dataDir = tmpDir();
  const id = "33333333-3333-3333-3333-333333333333";
  const first = await openStore({ dataDir });
  await first.createIntent(id, "https://meet.google.com/x");
  await first.close();
  const raw = new PGlite(dataDir);
  await raw.query(`INSERT INTO engine.consensus (session_id, doc_json, proto_json, updated_at) VALUES ($1, $2, $3, now())`, [id, '{"old":"shape"}', "not json"]);
  await raw.close();

  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const store = await openStore({ dataDir, log: (msg, fields) => logs.push({ msg, fields }) });
  assert.equal(await store.getConsensus(id), undefined);
  assert.deepEqual(logs, [{ msg: "store.consensus_invalid", fields: { session_id: id, doc_ok: false, proto_ok: false } }]);
  await store.close();
});

test("in-memory stores are separate databases", async () => {
  const a = await openStore();
  const b = await openStore();
  await a.createIntent("x", "https://meet.google.com/x");
  assert.equal(await b.getSession("x"), undefined);
  await Promise.all([a.close(), b.close()]);
});
