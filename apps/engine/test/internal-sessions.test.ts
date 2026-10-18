// POST /internal/sessions, the api's way to start a session (ADR 0008; E1-E4 in docs/plans/api-first-slice.md).
// Recall is a fake fetch, the store is in-memory SurrealDB, and requests and replies are checked with the
// @builder/contracts schemas. Nothing here calls Recall, a model or SurrealDB Cloud.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { StartSessionResponse } from "@builder/contracts";
import type { StartSessionRequest } from "@builder/contracts";
import { loadConfig, loadLocalConfig, internalToken } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { createApp } from "../src/app.ts";
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
const LIMITS = { maxUsd: 5, maxMinutes: 60 };

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

type RecallReply = (n: number) => Promise<Response>;
const created: RecallReply = async (n) => Response.json({ id: `bot-${n}` }, { status: 201 });

/** The engine with a fake Recall. `recall` answers each POST /bot/ call; `bots` records what each one asked for. */
async function startEngine(opts: { recall?: RecallReply; env?: Record<string, string | undefined> } = {}) {
  const config = loadConfig({ ...ENV, ...opts.env });
  const store = await testStore();
  const bots: { meeting_url: string; metadata: Record<string, string> }[] = [];
  const reply = opts.recall ?? created;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    if (!String(url).endsWith("/bot/") || init.method !== "POST") throw new Error(`unexpected Recall call ${init.method} ${url}`);
    bots.push(JSON.parse(String(init.body)));
    return reply(bots.length);
  }) as typeof fetch;
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeFetch, sleep: async () => {} });
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const app = await createApp({ config, recall, store, log: (msg, fields) => logs.push({ msg, fields }), indexHtml: "<html></html>", stageHtml: "<html>stage</html>" });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, store, bots, logs };
}

const request = (over: Partial<StartSessionRequest> = {}): StartSessionRequest =>
  ({ sessionId: randomUUID(), orgId: "org_a", meetingUrl: MEET, limits: LIMITS, ...over });

const start = (base: string, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  fetch(`${base}/internal/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

// ---- E1: the route ----

test("E1: starts a bot with the api's session id, saves the org and limits, and answers StartSessionResponse", async () => {
  const e = await startEngine();
  const r = request();
  const res = await start(e.base, r);
  assert.equal(res.status, 201);
  const body = StartSessionResponse.parse(await res.json());
  assert.equal(body.sessionId, r.sessionId);
  assert.equal(body.status, "joining");
  const s = await e.store.getSession(r.sessionId);
  assert.ok(s);
  assert.equal(body.stageUrl, `https://agent.example.com/stage/${r.sessionId}?token=${encodeURIComponent(s.stage_token!)}`);
  assert.deepEqual([s.state, s.bot_id, s.org_id, s.max_usd, s.max_minutes], ["created", "bot-1", "org_a", 5, 60]);
  assert.equal(e.bots.length, 1);
  assert.equal(e.bots[0].meeting_url, MEET);
  assert.equal(e.bots[0].metadata.session_id, r.sessionId, "Recall's events come back to this session");
});

test("E1: the shared bearer token is required, compared exactly", async () => {
  const e = await startEngine();
  const cases: Record<string, string>[] = [{}, { authorization: "Bearer wrong-token-0123456789abcdef0123456789" }, { authorization: TOKEN }, { authorization: `Bearer ${TOKEN}x` }, { authorization: `Basic ${TOKEN}` }];
  for (const headers of cases) {
    const res = await start(e.base, request(), headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.equal(await codeOf(res), "unauthorized");
  }
  assert.equal((await start(e.base, request(), { authorization: `bearer ${TOKEN}` })).status, 201, "the scheme is case-insensitive");
  assert.equal(e.bots.length, 1);
});

test("E1: a request that came through the public proxy is refused, even with the right token", async () => {
  const e = await startEngine();
  const proxies: Record<string, string>[] = [{ "x-forwarded-for": "203.0.113.9" }, { "cf-connecting-ip": "203.0.113.9" }, { "x-forwarded-host": "agent.example.com" }];
  for (const proxy of proxies) {
    const res = await start(e.base, request(), { authorization: `Bearer ${TOKEN}`, ...proxy });
    assert.equal(res.status, 404, JSON.stringify(proxy));
  }
  assert.equal(e.bots.length, 0);
});

test("E1: without ENGINE_INTERNAL_TOKEN the internal routes are off (404)", async () => {
  const e = await startEngine({ env: { ENGINE_INTERNAL_TOKEN: undefined } });
  assert.equal((await start(e.base, request())).status, 404);
  assert.equal((await start(e.base, request(), {})).status, 404);
  assert.equal(e.bots.length, 0);
});

test("E1: a request that isn't a valid StartSessionRequest is 400 invalid_request, and no bot is sent", async () => {
  const e = await startEngine();
  const bad: unknown[] = [
    "{not json", {}, { ...request(), sessionId: "not-a-uuid" }, { ...request(), sessionId: randomUUID().toUpperCase() },
    { ...request(), orgId: "" }, { ...request(), meetingUrl: "http://meet.google.com/abc" }, { ...request(), meetingUrl: "https://evil.example.com/x" },
    { ...request(), meetingUrl: "local:abc" }, { ...request(), limits: { maxUsd: -1, maxMinutes: 60 } }, { ...request(), limits: undefined },
  ];
  for (const body of bad) {
    const res = await start(e.base, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(await codeOf(res), "invalid_request");
  }
  assert.equal(e.bots.length, 0);
});

test("E1: other paths and methods under /internal answer 404", async () => {
  const e = await startEngine();
  const auth = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await fetch(`${e.base}/internal/sessions`, { headers: auth })).status, 404);
  assert.equal((await fetch(`${e.base}/internal/other`, { method: "POST", headers: auth })).status, 404);
});

test("E1: Recall refusing is 422 recall_rejected (no bot exists), saved as create_failed", async () => {
  const e = await startEngine({ recall: async () => new Response("bad meeting", { status: 400 }) });
  const r = request();
  const res = await start(e.base, r);
  assert.equal(res.status, 422);
  assert.equal(await codeOf(res), "recall_rejected");
  assert.equal((await e.store.getSession(r.sessionId))?.state, "create_failed");
});

test("E1: no clear answer from Recall is 504 recall_outcome_unknown, and the intent row stays", async () => {
  const e = await startEngine({ recall: async () => { throw new TypeError("fetch failed"); } });
  const r = request();
  const res = await start(e.base, r);
  assert.equal(res.status, 504);
  assert.equal(await codeOf(res), "recall_outcome_unknown");
  assert.equal((await e.store.getSession(r.sessionId))?.state, "intent");
  assert.equal(e.bots.length, 1, "asked once, never retried");
});

// ---- E2: the same sessionId never sends a second bot ----

test("E2: the same start sent again answers 200 with the same session, and no second bot", async () => {
  const e = await startEngine();
  const r = request();
  const first = StartSessionResponse.parse(await (await start(e.base, r)).json());
  const res = await start(e.base, r);
  assert.equal(res.status, 200);
  assert.deepEqual(StartSessionResponse.parse(await res.json()), first);
  assert.equal(e.bots.length, 1);
});

test("E2: the same start sent twice at once sends one bot", async () => {
  const e = await startEngine({ recall: async (n) => { await new Promise((r) => setTimeout(r, 30)); return Response.json({ id: `bot-${n}` }, { status: 201 }); } });
  const r = request();
  const replies = await Promise.all([start(e.base, r), start(e.base, r), start(e.base, r)]);
  const bodies = await Promise.all(replies.map(async (x) => StartSessionResponse.parse(await x.json())));
  assert.equal(e.bots.length, 1);
  assert.ok(bodies.every((b) => b.sessionId === r.sessionId && b.stageUrl === bodies[0].stageUrl));
});

test("E2: a repeat after an unclear or refused start answers the same way, without asking Recall again", async () => {
  const unclear = await startEngine({ recall: async () => { throw new TypeError("fetch failed"); } });
  const r = request();
  await start(unclear.base, r);
  const again = await start(unclear.base, r);
  assert.equal(again.status, 504);
  assert.equal(await codeOf(again), "recall_outcome_unknown");
  assert.equal(unclear.bots.length, 1);

  const refused = await startEngine({ recall: async () => new Response("no", { status: 400 }) });
  const q = request();
  await start(refused.base, q);
  const repeat = await start(refused.base, q);
  assert.equal(repeat.status, 422);
  assert.equal(refused.bots.length, 1);
});

test("E2: a sessionId already used by another org or meeting is 409 session_conflict, with nothing of that session", async () => {
  const e = await startEngine();
  const r = request();
  await start(e.base, r);
  for (const other of [{ ...r, orgId: "org_b" }, { ...r, meetingUrl: `${MEET}x` }]) {
    const res = await start(e.base, other);
    assert.equal(res.status, 409);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: { code: "session_conflict" } });
    assert.ok(!text.includes("stage"));
  }
  assert.equal(e.bots.length, 1);
});

test("E2: the replayed status follows the bot: in the meeting, ended or failed", async () => {
  const e = await startEngine();
  const r = request();
  await start(e.base, r);
  for (const [bot, status] of [["in_call_recording", "in_meeting"], ["call_ended", "ended"], ["fatal", "failed"]] as const) {
    await e.store.updateBotStatus(r.sessionId, bot, null);
    assert.equal(StartSessionResponse.parse(await (await start(e.base, r)).json()).status, status, bot);
  }
});

// ---- E3: reuse stays within one org ----

test("E3: another org starting the same meeting gets its own session and stage, never the first org's", async () => {
  const e = await startEngine();
  const a = StartSessionResponse.parse(await (await start(e.base, request({ orgId: "org_a" }))).json());
  const res = await start(e.base, request({ orgId: "org_b" }));
  assert.equal(res.status, 201);
  const b = StartSessionResponse.parse(await res.json());
  assert.notEqual(b.sessionId, a.sessionId);
  assert.notEqual(b.stageUrl, a.stageUrl);
  assert.equal(e.bots.length, 2, "each org has its own bot");
  assert.equal((await e.store.getSession(b.sessionId))?.org_id, "org_b");
});

test("E3: the same org starting a meeting it already has a bot in is 409 meeting_in_use, and no second bot", async () => {
  const e = await startEngine();
  await start(e.base, request({ orgId: "org_a" }));
  const res = await start(e.base, request({ orgId: "org_a" }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: { code: "meeting_in_use" } }, "and not the other session's id or stage URL");
  assert.equal(e.bots.length, 1);
  // Once that session has ended, the org can start the meeting again.
  const [s] = (await e.store.listSessions()).filter((x) => x.org_id === "org_a");
  await e.store.updateBotStatus(s.id, "done", null);
  assert.equal((await start(e.base, request({ orgId: "org_a" }))).status, 201);
});

test("E3: the operator's /api/sessions and an org's sessions never reuse each other", async () => {
  const e = await startEngine();
  const org = StartSessionResponse.parse(await (await start(e.base, request({ orgId: "org_a" }))).json());
  const op = await fetch(`${e.base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: MEET }) });
  assert.equal(op.status, 201, "the operator's start isn't handed the org's session");
  const opSession = ((await op.json()) as { session: { id: string; org_id: string | null } }).session;
  assert.notEqual(opSession.id, org.sessionId);
  assert.equal(opSession.org_id, null);
  // And the operator's own reuse works as before.
  const again = await fetch(`${e.base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: MEET }) });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { reused: boolean }).reused, true);
  assert.equal(e.bots.length, 2);
});

test("logs carry ids, statuses and codes, never the meeting URL, a token or a stage URL", async () => {
  const e = await startEngine();
  const r = request();
  const body = StartSessionResponse.parse(await (await start(e.base, r)).json());
  await start(e.base, r);
  await start(e.base, { ...r, orgId: "org_b" });
  const text = JSON.stringify(e.logs);
  for (const secret of [MEET, TOKEN, body.stageUrl, new URL(body.stageUrl).searchParams.get("token")!]) assert.ok(!text.includes(secret), secret);
  const starts = e.logs.filter((l) => l.msg === "internal.session_start").map((l) => [l.fields?.status, l.fields?.code ?? null]);
  assert.deepEqual(starts, [[201, null], [200, null], [409, "session_conflict"]]);
});

// ---- config ----

test("ENGINE_INTERNAL_TOKEN: unset is off, short is refused without quoting it, and local mode reads it too", () => {
  assert.equal(internalToken({}), null);
  assert.equal(internalToken({ ENGINE_INTERNAL_TOKEN: "  " }), null);
  assert.equal(loadConfig({ ...ENV }).internalToken, TOKEN);
  assert.throws(() => internalToken({ ENGINE_INTERNAL_TOKEN: "short-secret" }), (err: Error) =>
    /at least 32 characters/.test(err.message) && !err.message.includes("short-secret"));
  assert.equal(loadLocalConfig({ ENGINE_INTERNAL_TOKEN: TOKEN }).internalToken, TOKEN);
  assert.equal(loadLocalConfig({}).internalToken, null);
});
