// Known issue R1 (ADR 0008): the engine ends a session the api started once it reaches its limits, `maxMinutes`
// of bot time since Recall says the bot joined, or `maxUsd` of model spend. Recall is a fake fetch and the store
// is in-memory SurrealDB. Nothing here calls Recall, a model or SurrealDB Cloud.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { createApp } from "../src/app.ts";
import type { Store } from "../src/store.ts";
import type { AgentDeps } from "../src/app.ts";
import { testStore } from "./helpers/store.ts";

const TOKEN = "internal-test-token-0123456789abcdef";
const ENV = {
  RECALL_REGION: "us-west-2",
  RECALL_API_KEY: "test-key",
  RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
  PUBLIC_API_BASE_URL: "https://agent.example.com",
  ENGINE_INTERNAL_TOKEN: TOKEN,
};
const MEET = "https://meet.google.com/abc-defg-hij";
const MIN = 60_000;
const T0 = Date.parse("2026-10-18T12:00:00.000Z");

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

type Change = { code: string; at: number };

/**
 * The engine on a fake clock, with a fake Recall. `recall.changes` is the bot's status history; `recall.chats` and
 * `recall.leaves` record what the engine asked Recall to do. `failLeave` makes leave_call answer 500.
 */
async function startEngine(opts: { store?: Store; changes?: Change[]; agent?: AgentDeps } = {}) {
  const config = loadConfig(ENV);
  const store = opts.store ?? await testStore();
  const recall = { changes: opts.changes ?? [{ code: "in_call_recording", at: T0 }], chats: [] as string[], leaves: 0, failLeave: false };
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/bot/") && init.method === "POST") return Response.json({ id: "bot-1" }, { status: 201 });
    if (u.endsWith("/send_chat_message/")) {
      recall.chats.push(JSON.parse(String(init.body)).message);
      return Response.json({});
    }
    if (u.endsWith("/leave_call/")) {
      recall.leaves++;
      return recall.failLeave ? Response.json({ detail: "no" }, { status: 500 }) : Response.json({});
    }
    if (/\/bot\/[^/]+\/$/.test(u) && (init.method ?? "GET") === "GET") {
      return Response.json({
        id: "bot-1",
        status_changes: recall.changes.map((c) => ({ code: c.code, sub_code: null, message: null, created_at: new Date(c.at).toISOString() })),
      });
    }
    throw new Error(`unexpected Recall call ${init.method} ${u}`);
  }) as typeof fetch;
  const client = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeFetch, sleep: async () => {}, maxAttempts: 1 });
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const clock = { now: T0 };
  const app = await createApp({
    config, recall: client, store, clock: () => clock.now, ...(opts.agent ? { agent: opts.agent } : {}),
    log: (msg, fields) => logs.push({ msg, fields }), indexHtml: "<html></html>", stageHtml: "<html>stage</html>",
  });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, store, app, recall, logs, clock };
}

type Engine = Awaited<ReturnType<typeof startEngine>>;

async function startSession(e: Engine, limits = { maxUsd: 5, maxMinutes: 60 }): Promise<string> {
  const sessionId = randomUUID();
  const res = await fetch(`${e.base}/internal/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ sessionId, orgId: "org_a", meetingUrl: MEET, limits }),
  });
  assert.equal(res.status, 201);
  return sessionId;
}

const spend = (store: Store, sessionId: string, usd: number) => store.addModelCall({
  sessionId, loop: "build", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd, ms: 1,
});

const limitLogs = (e: Engine) => e.logs.filter((l) => l.msg === "session.limit_reached");

test("R1: under both limits, nothing happens", async () => {
  const e = await startEngine();
  const id = await startSession(e);
  await spend(e.store, id, 4.99);
  e.clock.now = T0 + 59 * MIN;
  await e.app.pollOnce();
  assert.deepEqual([e.recall.chats, e.recall.leaves], [[], 0]);
  assert.equal((await e.store.getSession(id))?.end_reason, null);
});

test("R1: at maxMinutes of bot time the bot says why in chat and leaves, once", async () => {
  const e = await startEngine();
  const id = await startSession(e);
  e.clock.now = T0 + 60 * MIN;
  await e.app.pollOnce();
  assert.equal(e.recall.chats.length, 1);
  assert.match(e.recall.chats[0], /time limit/);
  assert.equal(e.recall.leaves, 1);
  assert.equal((await e.store.getSession(id))?.end_reason, "max_minutes");
  assert.deepEqual(limitLogs(e).map((l) => l.fields), [{ session_id: id, limit: "max_minutes", minutes: 60, usd: 0 }]);
  assert.ok(e.logs.some((l) => l.msg === "session.ended" && l.fields?.status === "max_minutes"), "the agent stops for the session");
  const chat = (await e.store.listEvents(id)).filter((ev) => ev.kind === "bot_chat");
  assert.deepEqual(chat.map((ev) => ev.speaker), ["Builder"], "the line is in the session's record");

  // Recall still says in the call: no second message, and no second leave before the retry interval.
  e.clock.now += 10_000;
  await e.app.pollOnce();
  assert.deepEqual([e.recall.chats.length, e.recall.leaves, limitLogs(e).length], [1, 1, 1]);
});

test("R1: at maxUsd of model spend the bot says why in chat and leaves", async () => {
  const e = await startEngine();
  const id = await startSession(e, { maxUsd: 2, maxMinutes: 60 });
  await spend(e.store, id, 1.5);
  await spend(e.store, id, 0.5);
  e.clock.now = T0 + MIN;
  await e.app.pollOnce();
  assert.match(e.recall.chats[0], /spending limit/);
  assert.equal(e.recall.leaves, 1);
  assert.equal((await e.store.getSession(id))?.end_reason, "max_usd");
  assert.deepEqual(limitLogs(e)[0].fields, { session_id: id, limit: "max_usd", minutes: 1, usd: 2 });
});

test("R1: time in the waiting room doesn't count; bot time starts when Recall says it joined", async () => {
  const changes = [{ code: "joining_call", at: T0 }, { code: "in_waiting_room", at: T0 }, { code: "in_call_not_recording", at: T0 + 30 * MIN }, { code: "in_call_recording", at: T0 + 31 * MIN }];
  const e = await startEngine({ changes });
  await startSession(e);
  e.clock.now = T0 + 89 * MIN;
  await e.app.pollOnce();
  assert.equal(e.recall.leaves, 0, "59 minutes in the call");
  e.clock.now = T0 + 90 * MIN;
  await e.app.pollOnce();
  assert.equal(e.recall.leaves, 1);
});

test("R1: a bot that hasn't joined yet has used no minutes", async () => {
  const e = await startEngine({ changes: [{ code: "joining_call", at: T0 }] });
  await startSession(e, { maxUsd: 5, maxMinutes: 1 });
  e.clock.now = T0 + 5 * MIN;
  await e.app.pollOnce();
  assert.equal(e.recall.leaves, 0);
});

test("R1: sessions the operator starts from the local routes have no limits", async () => {
  const e = await startEngine();
  const res = await fetch(`${e.base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: MEET }) });
  const { session } = (await res.json()) as { session: { id: string } };
  await spend(e.store, session.id, 1000);
  e.clock.now = T0 + 24 * 60 * MIN;
  await e.app.pollOnce();
  assert.deepEqual([e.recall.chats, e.recall.leaves], [[], 0]);
});

test("R1: a leave that fails is tried again on a later poll, without a second message", async () => {
  const e = await startEngine();
  const id = await startSession(e);
  e.recall.failLeave = true;
  e.clock.now = T0 + 60 * MIN;
  await e.app.pollOnce();
  assert.equal(e.recall.leaves, 1);
  assert.ok(e.logs.some((l) => l.msg === "session.leave_failed" && l.fields?.session_id === id && l.fields?.status === 500));
  e.recall.failLeave = false;
  e.clock.now += 30_000;
  await e.app.pollOnce();
  assert.deepEqual([e.recall.chats.length, e.recall.leaves], [1, 2]);
});

test("R1: after a restart, a session already ending doesn't resume; it leaves again without a second message", async () => {
  const first = await startEngine();
  const id = await startSession(first);
  first.recall.failLeave = true;
  first.clock.now = T0 + 60 * MIN;
  await first.app.pollOnce();

  const second = await startEngine({ store: first.store });
  second.clock.now = T0 + 61 * MIN;
  await second.app.pollOnce();
  assert.deepEqual([second.recall.chats, second.recall.leaves], [[], 1]);
  assert.ok(second.logs.some((l) => l.msg === "session.ended" && l.fields?.session_id === id && l.fields?.status === "max_minutes"));
});

test("R1: with the agent on, a restart doesn't resume a session that was ending", async () => {
  const first = await startEngine();
  const id = await startSession(first);
  first.recall.failLeave = true;
  first.clock.now = T0 + 60 * MIN;
  await first.app.pollOnce();

  const port = { runTools: async () => { throw new Error("no model call expected"); } };
  const second = await startEngine({ store: first.store, agent: { port, clock: () => T0 + 61 * MIN } });
  assert.ok(!second.logs.some((l) => l.msg === "conversation.resumed"), "the conversation loop isn't picked up again");
  assert.ok(second.logs.some((l) => l.msg === "session.ended" && l.fields?.session_id === id && l.fields?.status === "max_minutes"));
  await second.app.pollOnce();
  assert.deepEqual([second.recall.chats, second.recall.leaves], [[], 1]);
  assert.equal(second.logs.filter((l) => l.msg === "session.ended").length, 1, "stopped once");
});
