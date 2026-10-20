// Session status events to the api (A2, ADR 0008): the event for a session, the reporter's delivery rules, the store
// query behind the restart sweep, the poll's hook, and API_INTERNAL_URL. The api is a fake fetch or a local
// node:http server; Recall is the local stand-in. Nothing here calls Recall, a model or SurrealDB Cloud.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { SessionStatusEvent } from "@builder/contracts";
import { createStatusReporter, EVENTS_PATH, statusEvent } from "../src/api-events.ts";
import { createApp } from "../src/app.ts";
import type { StatusChange } from "../src/app.ts";
import { apiInternalUrl, loadConfig, loadLocalConfig } from "../src/config.ts";
import { createLocalRecall } from "../src/local-recall.ts";
import type { Session } from "../src/store.ts";
import { testStore } from "./helpers/store.ts";

const TOKEN = "internal-test-token-0123456789abcdef";
const MEET = "https://meet.google.com/abc-defg-hij";
const API = "http://api.internal:10000";
const NOW = Date.parse("2026-10-20T12:00:00.000Z");

const servers = new Set<http.Server>();
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

function session(over: Partial<Session> = {}): Session {
  return {
    id: randomUUID(), meeting_url: MEET, state: "created", bot_id: "bot-1", bot_status: "ready", bot_sub_code: null, error: null,
    stage_token: "t", handoff_token: "h", stage_html: null, org_id: "org_a", max_usd: 5, max_minutes: 60, end_reason: null,
    created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), ...over,
  };
}

// ---- the event ----

test("each Recall status maps to the contract's status, with a fixed id per session and status", () => {
  const cases: [Partial<Session>, string, string | undefined][] = [
    [{ bot_status: "ready" }, "joining", undefined],
    [{ bot_status: "joining_call" }, "joining", undefined],
    [{ bot_status: "in_waiting_room" }, "joining", undefined],
    [{ bot_status: "in_call_not_recording" }, "in_meeting", undefined],
    [{ bot_status: "in_call_recording" }, "in_meeting", undefined],
    [{ bot_status: "call_ended" }, "ended", undefined],
    [{ bot_status: "done" }, "ended", undefined],
    [{ bot_status: "done", end_reason: "max_minutes" }, "ended", "max_minutes"],
    [{ bot_status: "done", end_reason: "max_usd" }, "ended", "max_usd"],
    [{ bot_status: "fatal", bot_sub_code: "meeting_not_found" }, "failed", "meeting_not_found"],
    [{ bot_status: "fatal", bot_sub_code: null }, "failed", "bot_failed"],
    [{ bot_status: "fatal", bot_sub_code: "Not A Code!" }, "failed", "bot_failed"],
  ];
  for (const [over, status, code] of cases) {
    const s = session(over);
    const e = statusEvent(s, new Date(NOW))!;
    assert.equal(SessionStatusEvent.safeParse(e).success, true, "a valid contract event");
    assert.deepEqual([e.status, e.errorCode], [status, code], JSON.stringify(over));
    assert.equal(e.id, `${s.id}:status:${status}`);
    assert.deepEqual([e.type, e.sessionId, e.orgId, e.at], ["session.status", s.id, "org_a", new Date(NOW).toISOString()]);
  }
});

test("the reason for an end or a failure comes from Recall's history: the done after call_ended has none", () => {
  const change = (code: string, sub_code: string | null = null) => ({ code, sub_code, message: null, created_at: new Date(NOW).toISOString() });
  const history = [change("joining_call"), change("in_call_recording"), change("call_ended", "bot_kicked_from_call"), change("done")];
  assert.equal(statusEvent(session({ bot_status: "done" }), new Date(NOW), history)!.errorCode, "bot_kicked_from_call");
  assert.equal(statusEvent(session({ bot_status: "done", end_reason: "max_usd" }), new Date(NOW), history)!.errorCode, "max_usd", "the engine's own limit wins");
  assert.equal(statusEvent(session({ bot_status: "done" }), new Date(NOW), [change("call_ended"), change("done")])!.errorCode, undefined, "no reason given");
  assert.equal(statusEvent(session({ bot_status: "fatal" }), new Date(NOW), [change("joining_call"), change("fatal", "meeting_not_found")])!.errorCode, "meeting_not_found");
  assert.equal(statusEvent(session({ bot_status: "done" }), new Date(NOW), [change("call_ended", "Bad Code")])!.errorCode, undefined, "not a plain code: left out");
});

test("sessions the api didn't start, or without a bot, have no event", () => {
  assert.equal(statusEvent(session({ org_id: null }), new Date(NOW)), null, "the operator's own session");
  assert.equal(statusEvent(session({ state: "intent", bot_id: null, bot_status: null }), new Date(NOW)), null);
  assert.equal(statusEvent(session({ state: "create_failed", bot_id: null, bot_status: null }), new Date(NOW)), null);
});

// ---- the reporter ----

type Sent = { url: string; auth: string | null; body: SessionStatusEvent };

/** A reporter against a fake api that answers with `reply` (a status, or a function throwing a network error). */
function harness(reply: (n: number, body: SessionStatusEvent) => number | Promise<number> = () => 200) {
  let now = NOW;
  const sent: Sent[] = [];
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const body = SessionStatusEvent.parse(JSON.parse(String(init.body)));
    sent.push({ url, auth: new Headers(init.headers).get("authorization"), body });
    return new Response(JSON.stringify({ applied: true }), { status: await reply(sent.length, body) });
  }) as typeof fetch;
  const store: { listOrgSessionsUpdatedSince: (since: Date) => Promise<Session[]> } = { listOrgSessionsUpdatedSince: async () => [] };
  const reporter = createStatusReporter({ apiUrl: API, token: TOKEN, store, log: (msg, fields) => logs.push({ msg, fields }), fetch: fakeFetch, clock: () => now });
  return { reporter, sent, logs, store, advance: (ms: number) => { now += ms; } };
}

test("a new status is sent once to the api's events route, with the bearer token", async () => {
  const h = harness();
  const s = session({ bot_status: "in_call_recording" });
  h.reporter.notify(s);
  await h.reporter.flush();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]!.url, `${API}${EVENTS_PATH}`);
  assert.equal(h.sent[0]!.auth, `Bearer ${TOKEN}`);
  assert.deepEqual([h.sent[0]!.body.sessionId, h.sent[0]!.body.status], [s.id, "in_meeting"]);
  assert.equal(h.reporter.waiting(), 0);
  // The same status again (a repeated poll, the restart sweep) isn't sent twice.
  h.reporter.notify(s);
  await h.reporter.flush();
  assert.equal(h.sent.length, 1);
});

test("the operator's sessions are never sent", async () => {
  const h = harness();
  h.reporter.notify(session({ org_id: null, bot_status: "in_call_recording" }));
  await h.reporter.flush();
  assert.equal(h.sent.length, 0);
});

test("a failed send is tried again after 2 s, then twice as long each time, up to 60 s", async () => {
  const h = harness(() => 503);
  h.reporter.notify(session());
  await h.reporter.flush();
  const gaps = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
  for (const gap of gaps) {
    const before = h.sent.length;
    h.advance(gap - 1);
    await h.reporter.flush();
    assert.equal(h.sent.length, before, `not before ${gap} ms`);
    h.advance(1);
    await h.reporter.flush();
    assert.equal(h.sent.length, before + 1, `again at ${gap} ms`);
  }
  assert.equal(h.reporter.waiting(), 1, "still waiting while the api is down");
});

test("401, 408, 429, 5xx and network errors are retried; other 4xx are dropped", async () => {
  for (const status of [401, 408, 429, 500, 502, 503]) {
    const h = harness((n) => (n === 1 ? status : 200));
    h.reporter.notify(session());
    await h.reporter.flush();
    h.advance(2_000);
    await h.reporter.flush();
    assert.deepEqual([h.sent.length, h.reporter.waiting()], [2, 0], `${status} is retried, then delivered`);
  }
  for (const status of [400, 403, 404, 409, 422]) {
    const h = harness(() => status);
    h.reporter.notify(session());
    await h.reporter.flush();
    h.advance(120_000);
    await h.reporter.flush();
    assert.deepEqual([h.sent.length, h.reporter.waiting()], [1, 0], `${status} is dropped`);
    assert.ok(h.logs.some((l) => l.msg === "api_events.dropped" && l.fields?.http === status));
  }
  const network = harness((n) => { if (n === 1) throw new TypeError("fetch failed"); return 200; });
  network.reporter.notify(session());
  await network.reporter.flush();
  network.advance(2_000);
  await network.reporter.flush();
  assert.deepEqual([network.sent.length, network.reporter.waiting()], [2, 0], "a network error is retried");
});

test("a send that hangs times out and is retried", async () => {
  let calls = 0;
  const hanging = ((_url: string, init: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  }) as typeof fetch;
  const logs: string[] = [];
  const reporter = createStatusReporter({ apiUrl: API, token: TOKEN, store: { listOrgSessionsUpdatedSince: async () => [] }, log: (m) => logs.push(m), fetch: hanging, timeoutMs: 20 });
  reporter.notify(session());
  await reporter.flush();
  assert.equal(calls, 1);
  assert.equal(reporter.waiting(), 1);
  assert.ok(logs.includes("api_events.retry"));
});

test("only the latest status waits: statuses that change during a send collapse into the newest", async () => {
  let release!: () => void;
  const h = harness((n) => (n === 1 ? new Promise<number>((r) => { release = () => r(503); }) : 200));
  const s = session({ bot_status: "joining_call" });
  h.reporter.notify(s);
  const run = h.reporter.flush();
  await new Promise((r) => setImmediate(r));
  h.reporter.notify({ ...s, bot_status: "in_call_recording" });
  h.reporter.notify({ ...s, bot_status: "done" });
  release();
  await run;
  assert.deepEqual(h.sent.map((x) => x.body.status), ["joining", "ended"], "in_meeting was replaced before it went out");
  assert.equal(h.reporter.waiting(), 0);
});

test("a new status is sent at once, without waiting out the older one's retry delay", async () => {
  const h = harness((n) => (n === 1 ? 503 : 200));
  const s = session({ bot_status: "joining_call" });
  h.reporter.notify(s);
  await h.reporter.flush();
  h.reporter.notify({ ...s, bot_status: "in_call_recording" });
  await h.reporter.flush();
  assert.deepEqual(h.sent.map((x) => x.body.status), ["joining", "in_meeting"]);
  assert.equal(h.reporter.waiting(), 0);
});

test("a status that changes while the older one is being sent is sent next, not lost", async () => {
  let release!: () => void;
  const h = harness((n) => (n === 1 ? new Promise<number>((r) => { release = () => r(200); }) : 200));
  const s = session({ bot_status: "joining_call" });
  h.reporter.notify(s);
  const first = h.reporter.flush();
  await new Promise((r) => setImmediate(r));
  h.reporter.notify({ ...s, bot_status: "in_call_recording" });
  release();
  await first;
  assert.equal(h.reporter.waiting(), 0, "in_meeting went out in the same run");
  assert.deepEqual(h.sent.map((x) => x.body.status), ["joining", "in_meeting"]);
});

test("a failure for one session doesn't hold up the others", async () => {
  const bad = session();
  const h = harness((_n, body) => (body.sessionId === bad.id ? 503 : 200));
  const good = session({ bot_status: "in_call_recording" });
  h.reporter.notify(bad);
  h.reporter.notify(good);
  await h.reporter.flush();
  assert.deepEqual(h.sent.map((x) => x.body.sessionId).sort(), [bad.id, good.id].sort());
  assert.equal(h.reporter.waiting(), 1);
});

test("the restart sweep queues the sessions the store returns, and survives the store failing", async () => {
  const h = harness();
  const a = session({ bot_status: "done" }), b = session({ bot_status: "in_call_recording" });
  let since: Date | null = null;
  h.store.listOrgSessionsUpdatedSince = async (d: Date) => { since = d; return [a, b]; };
  await h.reporter.sweep(new Date(NOW - 1000));
  await h.reporter.flush();
  assert.equal(since!.getTime(), NOW - 1000);
  assert.deepEqual(h.sent.map((x) => x.body.status).sort(), ["ended", "in_meeting"]);
  h.store.listOrgSessionsUpdatedSince = async () => { throw new Error("db down"); };
  await assert.doesNotReject(h.reporter.sweep(new Date(NOW)));
  assert.ok(h.logs.some((l) => l.msg === "api_events.sweep_failed"));
});

test("logs carry ids, statuses and codes only", async () => {
  const h = harness((n) => (n === 1 ? 503 : n === 2 ? 404 : 200));
  h.reporter.notify(session());
  await h.reporter.flush();
  h.advance(2_000);
  await h.reporter.flush();
  const text = JSON.stringify(h.logs);
  assert.ok(!text.includes(MEET) && !text.includes(TOKEN) && !text.includes("meet.google"), text);
  for (const l of h.logs) for (const k of Object.keys(l.fields ?? {})) assert.ok(["session_id", "status", "http", "attempts", "error", "sessions"].includes(k), k);
});

// ---- the store query behind the sweep ----

test("listOrgSessionsUpdatedSince: the api's sessions with a bot, changed after the time given", async () => {
  const store = await testStore();
  const org = { orgId: "org_a", maxUsd: 5, maxMinutes: 60 };
  const withBot = await store.createIntent(randomUUID(), MEET, org);
  await store.markCreated(withBot.id, `bot-${randomUUID()}`);
  const ended = await store.createIntent(randomUUID(), "https://meet.google.com/xyz-abcd-efg", org);
  await store.markCreated(ended.id, `bot-${randomUUID()}`);
  await store.updateBotStatus(ended.id, "done", null);
  await store.createIntent(randomUUID(), "https://meet.google.com/qqq-qqqq-qqq", org); // intent: no bot
  const operator = await store.createIntent(randomUUID(), "https://meet.google.com/ooo-oooo-ooo");
  await store.markCreated(operator.id, `bot-${randomUUID()}`);

  const ids = (await store.listOrgSessionsUpdatedSince(new Date(Date.now() - 60_000))).map((s) => s.id).sort();
  assert.deepEqual(ids, [withBot.id, ended.id].sort());
  assert.deepEqual(await store.listOrgSessionsUpdatedSince(new Date(Date.now() + 60_000)), [], "nothing changed after a later time");
});

// ---- the poll's hook ----

test("the poll tells onStatusChange about each new status, once, with the session as it now stands", async () => {
  const store = await testStore();
  const recall = createLocalRecall();
  const heard: Session[] = [];
  const histories: StatusChange[][] = [];
  const app = await createApp({
    config: loadLocalConfig({ ENGINE_INTERNAL_TOKEN: TOKEN }), recall, store, log: () => {},
    indexHtml: "", stageHtml: "", localHtml: "", onStatusChange: (s, changes) => { heard.push(s); histories.push(changes); },
  });
  const s = await store.createIntent(randomUUID(), MEET, { orgId: "org_a", maxUsd: 5, maxMinutes: 60 });
  const bot = await recall.createBot({ meetingUrl: MEET, botName: "Builder", realtimeWebhookUrl: "", screenshareUrl: "", variant: null, metadata: {} });
  await store.markCreated(s.id, bot.id);

  await app.pollOnce();
  assert.deepEqual(heard.map((h) => [h.id, h.bot_status, h.org_id]), [[s.id, "in_call_recording", "org_a"]]);
  assert.deepEqual(histories[0]!.map((c) => c.code), ["in_call_recording"], "with Recall's history for the bot");
  await app.pollOnce();
  assert.equal(heard.length, 1, "no change, no call");
  await recall.leaveCall(bot.id);
  await app.pollOnce();
  assert.deepEqual(heard.map((h) => h.bot_status), ["in_call_recording", "done"]);
  assert.equal((await store.getSession(s.id))?.bot_status, "done", "saved before the call");
});

test("a throwing onStatusChange is logged and the poll goes on", async () => {
  const store = await testStore();
  const recall = createLocalRecall();
  const logs: string[] = [];
  const app = await createApp({
    config: loadLocalConfig({}), recall, store, log: (m) => logs.push(m), indexHtml: "", stageHtml: "", localHtml: "",
    onStatusChange: () => { throw new Error("boom"); },
  });
  const s = await store.createIntent(randomUUID(), MEET, { orgId: "org_a", maxUsd: 5, maxMinutes: 60 });
  const bot = await recall.createBot({ meetingUrl: MEET, botName: "Builder", realtimeWebhookUrl: "", screenshareUrl: "", variant: null, metadata: {} });
  await store.markCreated(s.id, bot.id);
  await assert.doesNotReject(app.pollOnce());
  assert.ok(logs.includes("status.notify_failed"));
  assert.ok(logs.includes("bot.status"));
});

test("end to end: the poll's change reaches a real api server as one valid event", async () => {
  const received: { auth: string | undefined; body: unknown }[] = [];
  const api = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(200, { "content-type": "application/json" }).end('{"applied":true}');
    });
  });
  servers.add(api);
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;

  const store = await testStore();
  const recall = createLocalRecall();
  const reporter = createStatusReporter({ apiUrl, token: TOKEN, store, log: () => {} });
  const app = await createApp({ config: loadLocalConfig({}), recall, store, log: () => {}, indexHtml: "", stageHtml: "", localHtml: "", onStatusChange: reporter.notify });
  const s = await store.createIntent(randomUUID(), MEET, { orgId: "org_a", maxUsd: 5, maxMinutes: 60 });
  const bot = await recall.createBot({ meetingUrl: MEET, botName: "Builder", realtimeWebhookUrl: "", screenshareUrl: "", variant: null, metadata: {} });
  await store.markCreated(s.id, bot.id);
  await app.pollOnce();
  await reporter.flush();

  assert.equal(received.length, 1);
  assert.equal(received[0]!.auth, `Bearer ${TOKEN}`);
  const e = SessionStatusEvent.parse(received[0]!.body);
  assert.deepEqual([e.sessionId, e.orgId, e.status], [s.id, "org_a", "in_meeting"]);
});

// ---- API_INTERNAL_URL ----

test("API_INTERNAL_URL: an origin, or Render's host:port; unset turns events off", () => {
  assert.equal(apiInternalUrl({}, TOKEN), null);
  assert.equal(apiInternalUrl({ API_INTERNAL_URL: "  " }, TOKEN), null);
  assert.equal(apiInternalUrl({ API_INTERNAL_URL: "http://localhost:3001" }, TOKEN), "http://localhost:3001");
  assert.equal(apiInternalUrl({ API_INTERNAL_URL: "https://api.example.com/" }, TOKEN), "https://api.example.com");
  assert.equal(apiInternalUrl({ API_INTERNAL_URL: "builder-api:10000" }, TOKEN), "http://builder-api:10000");
  assert.equal(apiInternalUrl({ API_INTERNAL_URL: "http://api:80" }, TOKEN), "http://api");
});

test("API_INTERNAL_URL: a path, query, credentials or another scheme is refused, without quoting the value", () => {
  for (const bad of ["http://api:3001/v1", "http://api:3001/?x=1", "http://api:3001#a", "http://user:pw@api:3001", "ftp://api", "not a url at all"]) {
    assert.throws(() => apiInternalUrl({ API_INTERNAL_URL: bad }, TOKEN), (err: Error) => /API_INTERNAL_URL/.test(err.message) && !err.message.includes(bad), bad);
  }
});

test("API_INTERNAL_URL needs ENGINE_INTERNAL_TOKEN, in both config loaders", () => {
  assert.throws(() => apiInternalUrl({ API_INTERNAL_URL: "http://localhost:3001" }, null), /ENGINE_INTERNAL_TOKEN/);
  assert.throws(() => loadLocalConfig({ API_INTERNAL_URL: "http://localhost:3001" }), /ENGINE_INTERNAL_TOKEN/);
  const local = loadLocalConfig({ API_INTERNAL_URL: "http://localhost:3001", ENGINE_INTERNAL_TOKEN: TOKEN });
  assert.deepEqual([local.apiInternalUrl, local.internalToken], ["http://localhost:3001", TOKEN]);
  const full = loadConfig({
    RECALL_REGION: "us-west-2", RECALL_API_KEY: "k", RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("t").toString("base64"),
    PUBLIC_API_BASE_URL: "https://agent.example.com", ENGINE_INTERNAL_TOKEN: TOKEN, API_INTERNAL_URL: "builder-api:10000",
  });
  assert.equal(full.apiInternalUrl, "http://builder-api:10000");
  assert.equal(loadLocalConfig({}).apiInternalUrl, null, "local mode without it: no events, as before");
});
