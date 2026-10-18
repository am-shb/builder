import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { openStore } from "../src/store.ts";
import { createApp, REALTIME_PATH } from "../src/app.ts";
import { verifyRequestFromRecall, signForTest } from "../src/verify.ts";
import { parseRealtimeEvent } from "../src/realtime.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = "whsec_" + Buffer.from("unit-test-secret").toString("base64");
const ENV = {
  RECALL_REGION: "us-west-2",
  RECALL_API_KEY: "test-key",
  RECALL_WEBHOOK_VERIFICATION_SECRET: SECRET,
  PUBLIC_API_BASE_URL: "https://agent.example.com/",
};

type Call = { url: string; init: RequestInit };

// Close servers even when an assertion throws before a test's own close().
const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

async function startApp(fakeFetch: typeof fetch) {
  const config = loadConfig(ENV);
  const store = openStore(":memory:");
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeFetch, sleep: async () => {} });
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const app = createApp({ config, recall, store, log: (msg, fields) => logs.push({ msg, fields }), indexHtml: "<html></html>", stageHtml: "<html>stage</html>" });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const close = () => new Promise((r) => { openServers.delete(server); server.closeAllConnections(); server.close(r); });
  return { base, store, app, logs, close };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });

function transcriptPayload(sessionId: string, botId: string, words: string[], event = "transcript.data") {
  return JSON.stringify({
    event,
    data: { bot: { id: botId, metadata: { session_id: sessionId } }, data: { participant: { name: "Ada" }, words: words.map((text) => ({ text })) } },
  });
}

// ---------- config ----------
test("config requires every Recall setting and names missing ones without values", () => {
  assert.throws(() => loadConfig({ RECALL_API_KEY: "secret-value" }), (e: Error) =>
    e.message.includes("RECALL_REGION") && e.message.includes("PUBLIC_API_BASE_URL") && !e.message.includes("secret-value"));
  assert.throws(() => loadConfig({ ...ENV, PUBLIC_API_BASE_URL: "https://localhost:3000" }), /publicly reachable/);
  assert.throws(() => loadConfig({ ...ENV, RECALL_WEBHOOK_VERIFICATION_SECRET: "nope" }), /whsec_/);
  assert.equal(loadConfig(ENV).publicBaseUrl, "https://agent.example.com");
});

// ---------- verification ----------
test("verification accepts Recall signatures and rejects tampering, stale and missing headers", () => {
  const body = '{"a":1}';
  const headers = signForTest(SECRET, body);
  verifyRequestFromRecall({ secret: SECRET, headers, payload: body });
  assert.throws(() => verifyRequestFromRecall({ secret: SECRET, headers, payload: '{"a":2}' }), /no matching/);
  assert.throws(() => verifyRequestFromRecall({ secret: SECRET, headers: {}, payload: body }), /missing/);
  const stale = signForTest(SECRET, body, "m", 1_000);
  assert.throws(() => verifyRequestFromRecall({ secret: SECRET, headers: stale, payload: body }), /tolerance/);
  // Rotation: multiple signatures, one valid.
  const rotated = { ...headers, "webhook-signature": `v1,AAAA ${headers["webhook-signature"]}` };
  verifyRequestFromRecall({ secret: SECRET, headers: rotated, payload: body });
});

// ---------- Recall client ----------
test("createBot sends region URL, raw key auth, low-latency Recall transcription and realtime webhook", async () => {
  const calls: Call[] = [];
  const recall = createRecallClient({
    region: "us-west-2", apiKey: "k123",
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return Response.json({ id: "b1" }); }) as any,
  });
  await recall.createBot({ meetingUrl: "https://meet.google.com/x", botName: "Agent", realtimeWebhookUrl: "https://a.example.com/recall/realtime/", metadata: { session_id: "s" } });
  assert.equal(calls[0].url, "https://us-west-2.recall.ai/api/v1/bot/");
  assert.equal((calls[0].init.headers as any).Authorization, "k123");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.recording_config.transcript.provider, { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } });
  assert.equal(body.recording_config.transcript.diarization.use_separate_streams_when_available, true);
  assert.equal(body.recording_config.realtime_endpoints[0].type, "webhook");
  assert.ok(body.recording_config.realtime_endpoints[0].events.includes("transcript.data"));
  assert.equal(body.metadata.session_id, "s");
  assert.equal(body.chat.on_bot_join.send_to, "everyone");
});

test("client honours Retry-After on 429, retries 503, and does not retry network errors", async () => {
  const sleeps: number[] = [];
  let n = 0;
  const recall = createRecallClient({
    region: "us-west-2", apiKey: "k", sleep: async (ms) => { sleeps.push(ms); },
    fetch: (async () => {
      n++;
      if (n === 1) return new Response("slow down", { status: 429, headers: { "Retry-After": "7" } });
      if (n === 2) return new Response("", { status: 503 });
      return Response.json({ id: "b" });
    }) as any,
  });
  assert.equal((await recall.getBot("b")).id, "b");
  assert.equal(sleeps[0], 7000);
  assert.equal(sleeps.length, 2);

  let attempts = 0;
  const flaky = createRecallClient({ region: "us-west-2", apiKey: "k", fetch: (async () => { attempts++; throw new TypeError("socket hang up"); }) as any });
  await assert.rejects(flaky.createBot({ meetingUrl: "https://meet.google.com/x", botName: "A", realtimeWebhookUrl: "https://a/", metadata: {} }));
  assert.equal(attempts, 1);
});

// ---------- realtime parsing ----------
test("parses transcript, partial, participant and chat events; ignores unknown", () => {
  const u = parseRealtimeEvent(JSON.parse(transcriptPayload("s", "b", ["hi", "there"])))!;
  assert.deepEqual([u.kind, u.speaker, u.text, u.sessionId, u.botId], ["utterance", "Ada", "hi there", "s", "b"]);
  assert.equal(parseRealtimeEvent(JSON.parse(transcriptPayload("s", "b", ["h"], "transcript.partial_data")))!.kind, "partial");
  const chat = parseRealtimeEvent({ event: "participant_events.chat_message", data: { bot: { id: "b" }, data: { participant: { name: "Bo" }, data: { text: "build a todo app" } } } })!;
  assert.deepEqual([chat.kind, chat.text], ["chat", "build a todo app"]);
  assert.equal(parseRealtimeEvent({ event: "audio_mixed_raw.data" }), null);
});

// ---------- end-to-end through the HTTP boundary ----------
test("meeting URL -> intent persisted before Recall call -> bot id stored -> verified utterance visible", async () => {
  let intentSeenDuringCreate = false;
  let ctx: Awaited<ReturnType<typeof startApp>>;
  ctx = await startApp((async (url: string) => {
    if (url.endsWith("/bot/")) {
      intentSeenDuringCreate = ctx.store.listSessions().some((s) => s.state === "intent");
      return Response.json({ id: "bot-1" }, { status: 201 });
    }
    return Response.json({ id: "bot-1", status_changes: [{ code: "joining_call", sub_code: null }, { code: "in_call_recording", sub_code: null }] });
  }) as any);

  const res = await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/abc-defg-hij" });
  assert.equal(res.status, 201);
  const { session } = (await res.json()) as any;
  assert.equal(intentSeenDuringCreate, true);
  assert.equal(session.bot_id, "bot-1");
  assert.equal(session.state, "created");

  // Same meeting again: reuse, never a second bot.
  const again = await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/abc-defg-hij" });
  assert.equal(((await again.json()) as any).reused, true);

  const payload = transcriptPayload(session.id, "bot-1", ["let's", "build", "a", "landing", "page"]);
  const headers = signForTest(SECRET, payload, "msg_1");
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, payload, headers)).status, 200);
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, payload, headers)).status, 200); // Recall retry
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, payload, { ...headers, "webhook-signature": "v1,AAAA" })).status, 401);
  await new Promise((r) => setTimeout(r, 30));
  await ctx.app.pollOnce();

  const view = (await (await fetch(`${ctx.base}/api/sessions/${session.id}`)).json()) as any;
  assert.equal(view.session.events.length, 1, "duplicate delivery must be processed once");
  assert.equal(view.session.events[0].text, "let's build a landing page");
  assert.equal(view.session.events[0].speaker, "Ada");
  assert.equal(view.session.bot_status, "in_call_recording");
  assert.ok(ctx.logs.some((l) => l.msg === "realtime.duplicate"));
  assert.ok(!JSON.stringify(ctx.logs).includes("landing page"), "transcript content must not be logged");
  await ctx.close();
});

test("live SSE stream delivers partials and finalized utterances to the browser", async () => {
  const ctx = await startApp((async () => Response.json({ id: "bot-2" }, { status: 201 })) as any);
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/sse-test-abc" })).json()) as any;
  const stream = await fetch(`${ctx.base}/api/sessions/${session.id}/stream`);
  const reader = stream.body!.getReader();
  for (const [event, words, id] of [["transcript.partial_data", ["hel"], "p1"], ["transcript.data", ["hello"], "f1"]] as const) {
    const p = transcriptPayload(session.id, "bot-2", [...words], event);
    await post(`${ctx.base}${REALTIME_PATH}`, p, signForTest(SECRET, p, id));
  }
  let text = "";
  while (!(text.includes("event: partial") && text.includes("event: event"))) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"text":"hel"/);
  assert.match(text, /"text":"hello"/);
  await reader.cancel();
  await ctx.close();
});

test("Recall rejection marks the session failed and is shown; ambiguous network failure is not retried", async () => {
  const rejected = await startApp((async () => new Response('{"meeting_url":["invalid"]}', { status: 400 })) as any);
  const r = await post(`${rejected.base}/api/sessions`, { meeting_url: "https://meet.google.com/bad-bad-bad" });
  const body = (await r.json()) as any;
  assert.equal(r.status, 502);
  assert.equal(body.session.state, "create_failed");
  assert.match(body.error, /400/);
  // A failed attempt doesn't block trying again.
  assert.equal((await post(`${rejected.base}/api/sessions`, { meeting_url: "https://meet.google.com/bad-bad-bad" })).status, 502);
  await rejected.close();

  let creates = 0;
  const lost = await startApp((async () => { creates++; throw new TypeError("connection reset"); }) as any);
  assert.equal((await post(`${lost.base}/api/sessions`, { meeting_url: "https://meet.google.com/lost-lost-lost" })).status, 504);
  const retry = await post(`${lost.base}/api/sessions`, { meeting_url: "https://meet.google.com/lost-lost-lost" });
  assert.equal(retry.status, 409, "unresolved intent blocks a duplicate create");
  assert.equal(creates, 1);
  await lost.close();
});

test("rejects non-meeting URLs and fatal lifecycle is surfaced", async () => {
  const ctx = await startApp((async (url: string) =>
    url.endsWith("/bot/") ? Response.json({ id: "bot-3" }) :
    Response.json({ id: "bot-3", status_changes: [{ code: "fatal", sub_code: "meeting_not_found", message: "x" }] })) as any);
  assert.equal((await post(`${ctx.base}/api/sessions`, { meeting_url: "https://evil.example.com/x" })).status, 400);
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/fat-alfa-tal" })).json()) as any;
  await ctx.app.pollOnce();
  const view = (await (await fetch(`${ctx.base}/api/sessions/${session.id}`)).json()) as any;
  assert.deepEqual([view.session.bot_status, view.session.bot_sub_code], ["fatal", "meeting_not_found"]);
  assert.equal((await post(`${ctx.base}/api/sessions/${session.id}/chat`, { message: "hi" })).status, 409);
  await ctx.close();
});

// ---------- output media: shared screen ----------
test("new bots screenshare a token-gated stage page; stage reflects pushed HTML", async () => {
  const bodies: any[] = [];
  const ctx = await startApp((async (url: string, init: RequestInit) => {
    if (init.body) bodies.push({ url, method: init.method, body: JSON.parse(init.body as string) });
    return Response.json({ id: "bot-4" }, { status: 201 });
  }) as any);
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/sta-gepa-gex" })).json()) as any;

  const create = bodies.find((b) => b.url.endsWith("/bot/")).body;
  const shareUrl = new URL(create.output_media.screenshare.config.url);
  assert.equal(create.output_media.screenshare.kind, "webpage");
  assert.equal(shareUrl.origin, "https://agent.example.com");
  assert.equal(shareUrl.pathname, `/stage/${session.id}`);
  const token = shareUrl.searchParams.get("token")!;
  assert.ok(token.length >= 32);

  assert.equal((await fetch(`${ctx.base}/stage/${session.id}`)).status, 404, "no token");
  assert.equal((await fetch(`${ctx.base}/stage/${session.id}?token=wrong`)).status, 404, "bad token");
  const page = await fetch(`${ctx.base}/stage/${session.id}?token=${token}`, { headers: { "cf-connecting-ip": "1.2.3.4" } });
  assert.equal(page.status, 200, "stage is reachable through the tunnel with its token");

  assert.equal((await post(`${ctx.base}/api/sessions/${session.id}/stage`, { html: "<h1>Todo app</h1>" })).status, 200);
  const state = (await (await fetch(`${ctx.base}/stage/${session.id}/state?token=${token}`)).json()) as any;
  assert.equal(state.html, "<h1>Todo app</h1>");

  assert.equal((await post(`${ctx.base}/api/sessions/${session.id}/screenshare`, {})).status, 200);
  const start = bodies.find((b) => b.url.endsWith("/output_media/") && b.method === "POST");
  assert.equal(start.url, "https://us-west-2.recall.ai/api/v1/bot/bot-4/output_media/");
  assert.equal(start.body.screenshare.config.url, shareUrl.toString());
  assert.equal((await fetch(`${ctx.base}/api/sessions/${session.id}/screenshare`, { method: "DELETE" })).status, 200);
  assert.deepEqual(bodies.find((b) => b.method === "DELETE").body, { screenshare: true });
  await ctx.close();
});

test("through the tunnel only the stage and signed Recall webhook are reachable", async () => {
  const ctx = await startApp((async () => Response.json({ id: "bot-5" }, { status: 201 })) as any);
  const proxied = { "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9" };
  assert.equal((await fetch(`${ctx.base}/`, { headers: proxied })).status, 404);
  assert.equal((await fetch(`${ctx.base}/api/sessions`, { headers: proxied })).status, 404);
  assert.equal((await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/aaa-bbbb-ccc" }, proxied)).status, 404);
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/aaa-bbbb-ccc" })).json()) as any;
  const p = transcriptPayload(session.id, "bot-5", ["via", "tunnel"]);
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, p, { ...proxied, ...signForTest(SECRET, p, "t1") })).status, 200);
  await ctx.close();
});

test("databases created before the stage columns are migrated and old sessions get a stage token", () => {
  const path = join(mkdtempSync(join(tmpdir(), "m2b-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, meeting_url TEXT NOT NULL, state TEXT NOT NULL, bot_id TEXT UNIQUE,
    bot_status TEXT, bot_sub_code TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO sessions VALUES ('11111111-1111-1111-1111-111111111111','https://meet.google.com/x','created','b','in_call_recording',NULL,NULL,'t','t');`);
  old.close();
  const store = openStore(path);
  const token = store.ensureStageToken("11111111-1111-1111-1111-111111111111");
  assert.ok(token.length >= 32);
  assert.equal(store.ensureStageToken("11111111-1111-1111-1111-111111111111"), token, "stable once issued");
  store.close();
});

test("stage routes never serve transcript text: /state has no captions and there is no public stream (known issue I7)", async () => {
  const ctx = await startApp((async () => Response.json({ id: "bot-6" }, { status: 201 })) as any);
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/cap-tion-sss" })).json()) as any;
  const token = new URL(((await (await fetch(`${ctx.base}/api/sessions/${session.id}`)).json()) as any).session.stage_url).searchParams.get("token");
  const final = transcriptPayload(session.id, "bot-6", ["secret", "roadmap"]);
  await post(`${ctx.base}${REALTIME_PATH}`, final, signForTest(SECRET, final, "u-1"));
  const partial = transcriptPayload(session.id, "bot-6", ["typing", "now"], "transcript.partial_data");
  await post(`${ctx.base}${REALTIME_PATH}`, partial, signForTest(SECRET, partial, "p-1"));
  await new Promise((r) => setTimeout(r, 30));

  const tunnel = { "x-forwarded-for": "1.2.3.4" };
  const res = await fetch(`${ctx.base}/stage/${session.id}/state?token=${token}`, { headers: tunnel });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(JSON.parse(body).type, "snapshot");
  assert.equal("captions" in JSON.parse(body), false);
  assert.doesNotMatch(body, /secret|roadmap|typing|Ada/, "no transcript text or speaker names");
  assert.equal((await fetch(`${ctx.base}/stage/${session.id}/stream?token=${token}`, { headers: tunnel })).status, 404, "no public transcript stream");
  // The operator's own stream (local only) still works.
  assert.equal((await fetch(`${ctx.base}/api/sessions/${session.id}/stream`, { headers: tunnel })).status, 404, "not through the tunnel");
  await ctx.close();
});

// ---------- crash safety (known issue I6) ----------
test("an error while processing a realtime event is logged by name and the server keeps running", async () => {
  const config = loadConfig(ENV);
  const store = openStore(":memory:");
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({ id: "bot-7" }, { status: 201 })) as any, sleep: async () => {} });
  const app = createApp({
    config, recall, store, log: (msg, fields) => logs.push({ msg, fields }), indexHtml: "", stageHtml: "",
    runtime: () => { throw new SyntaxError("Unexpected token in secret roadmap"); },
  });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const { session } = (await (await post(`${base}/api/sessions`, { meeting_url: "https://meet.google.com/cra-shes-not" })).json()) as any;
  for (const [i, event] of ["transcript.partial_data", "transcript.data"].entries()) {
    const p = transcriptPayload(session.id, "bot-7", ["hello"], event);
    assert.equal((await post(`${base}${REALTIME_PATH}`, p, signForTest(SECRET, p, `crash-${i}`))).status, 200);
  }
  await new Promise((r) => setTimeout(r, 30));
  const failed = logs.filter((l) => l.msg === "realtime.process_failed");
  assert.equal(failed.length, 2);
  assert.deepEqual(failed[0].fields, { error: "SyntaxError" }, "the name only, never the message");
  assert.equal((await fetch(`${base}/healthz`)).status, 200, "still serving");
  openServers.delete(server);
  server.closeAllConnections();
  server.close();
});

test("a stored consensus row that no longer parses reads as absent instead of throwing", () => {
  const path = join(mkdtempSync(join(tmpdir(), "m2b-")), "bad.db");
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const store = openStore(path, { log: (msg, fields) => logs.push({ msg, fields }) });
  const id = "33333333-3333-3333-3333-333333333333";
  store.createIntent(id, "https://meet.google.com/x");
  const raw = new DatabaseSync(path);
  raw.prepare(`INSERT INTO consensus (session_id, doc_json, proto_json, updated_at) VALUES (?, ?, ?, 't')`).run(id, '{"old":"shape"}', "not json");
  raw.close();
  assert.equal(store.getConsensus(id), undefined);
  assert.deepEqual(logs, [{ msg: "store.consensus_invalid", fields: { session_id: id, doc_ok: false, proto_ok: false } }]);
  store.close();
});

test("databases created before handoff tokens get one on first use, distinct from the stage token", () => {
  const path = join(mkdtempSync(join(tmpdir(), "m2b-")), "old2.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, meeting_url TEXT NOT NULL, state TEXT NOT NULL, bot_id TEXT UNIQUE,
    bot_status TEXT, bot_sub_code TEXT, error TEXT, stage_token TEXT, stage_html TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO sessions VALUES ('44444444-4444-4444-4444-444444444444','https://meet.google.com/x','created','b','done',NULL,NULL,'stage-tok',NULL,'t','t');`);
  old.close();
  const store = openStore(path);
  const token = store.ensureHandoffToken("44444444-4444-4444-4444-444444444444");
  assert.ok(token.length >= 32);
  assert.notEqual(token, "stage-tok");
  assert.equal(store.ensureHandoffToken("44444444-4444-4444-4444-444444444444"), token, "stable once issued");
  store.close();
});

test("stage page hides the placeholder for real and does not depend on SSE", () => {
  const html = readFileSync(new URL("../public/stage.html", import.meta.url), "utf8");
  assert.match(html, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, "author display rules must not override [hidden]");
  assert.doesNotMatch(html, /new EventSource\(/, "Cloudflare quick tunnels buffer text/event-stream; stage must poll");
});

test("BOT_VARIANT defaults to web_4_core; BOT_VARIANT=web means no variant", async () => {
  assert.throws(() => loadConfig({ ...ENV, BOT_VARIANT: "huge" }), /BOT_VARIANT/);
  assert.equal(loadConfig(ENV).botVariant, "web_4_core");
  assert.equal(loadConfig({ ...ENV, BOT_VARIANT: "web" }).botVariant, null);
  const bodies: any[] = [];
  const fake = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string)); return Response.json({ id: "b" }); }) as any;
  const recall = createRecallClient({ region: "us-west-2", apiKey: "k", fetch: fake });
  const base = { meetingUrl: "https://meet.google.com/x", botName: "A", realtimeWebhookUrl: "https://a/", metadata: {} };
  await recall.createBot(base);
  await recall.createBot({ ...base, variant: loadConfig(ENV).botVariant });
  assert.equal(bodies[0].variant, undefined);
  assert.equal(bodies[1].variant.google_meet, "web_4_core");
});
