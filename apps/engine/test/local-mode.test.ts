import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig, loadLocalConfig } from "../src/config.ts";
import { createLocalRecall } from "../src/local-recall.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { openStore } from "../src/store.ts";
import { createApp, REALTIME_PATH } from "../src/app.ts";
import { createFakePort } from "../src/agent/llm.ts";
import { signForTest } from "../src/verify.ts";

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

async function startLocal(opts: { speaking?: boolean } = {}) {
  const config = loadLocalConfig({});
  const store = await openStore();
  const stops: string[] = [];
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const agent = opts.speaking === undefined ? undefined : {
    port: createFakePort([]),
    speech: { say: async () => "u", stop: (id: string) => void stops.push(id), speaking: () => opts.speaking! },
  };
  const app = await createApp({
    config, store, recall: createLocalRecall(), log: (msg, fields) => logs.push({ msg, fields }),
    indexHtml: "<html></html>", stageHtml: "<html>stage</html>", localHtml: "<html>local</html>", ...(agent ? { agent } : {}),
  });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return { base, store, app, stops, logs, config };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", body: JSON.stringify(body), headers });

async function newLocalSession(base: string) {
  const res = await fetch(`${base}/api/local/sessions`, { method: "POST" });
  assert.equal(res.status, 201);
  return ((await res.json()) as any).session;
}

test("local config needs no Recall settings and serves the stage from localhost", () => {
  const c = loadLocalConfig({ PORT: "4100", OPENROUTER_API_KEY: "k", TTS_VOICE: "george" });
  assert.equal(c.local, true);
  assert.equal(c.publicBaseUrl, "http://localhost:4100");
  assert.equal(c.databaseUrl, null);
  assert.equal(c.pgliteDir, "data/local-pg");
  assert.equal(loadLocalConfig({ DATABASE_URL: "postgres://real" }).databaseUrl, null, "local sessions never go to the real database");
  assert.ok(c.verificationSecret.startsWith("whsec_"));
  assert.notEqual(c.verificationSecret, loadLocalConfig({}).verificationSecret, "webhook secret is random per run");
  assert.equal(c.agentEnabled, true);
  assert.equal(c.ttsVoice, "george");
  assert.equal(loadConfig({
    RECALL_REGION: "us-west-2", RECALL_API_KEY: "k", RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_x", PUBLIC_API_BASE_URL: "https://a.example.com",
  }).local, false);
});

test("local recall: a bot is in the call at once, leaves when asked, and unknown bots read as done", async () => {
  const recall = createLocalRecall();
  const bot = await recall.createBot({ meetingUrl: "local:x", botName: "Builder", realtimeWebhookUrl: "", metadata: {} });
  assert.equal((await recall.getBot(bot.id)).status_changes?.at(-1)?.code, "in_call_recording");
  await recall.leaveCall(bot.id);
  assert.equal((await recall.getBot(bot.id)).status_changes?.at(-1)?.code, "done");
  assert.equal((await recall.getBot("local-gone")).status_changes?.at(-1)?.code, "done");
});

test("local session starts recording at once; mic speech is stored like a Recall utterance", async () => {
  const { base, store, logs } = await startLocal();
  const session = await newLocalSession(base);
  assert.equal(session.bot_status, "in_call_recording");
  assert.match(session.stage_url, /^http:\/\/localhost:\d+\/stage\//);

  assert.equal((await post(`${base}/api/sessions/${session.id}/speech`, { kind: "join", speaker: "Amir" })).status, 200);
  assert.equal((await post(`${base}/api/sessions/${session.id}/speech`, { kind: "partial", speaker: "Amir", text: "a to do" })).status, 200);
  assert.equal((await post(`${base}/api/sessions/${session.id}/speech`, { kind: "utterance", speaker: "Amir", text: "a to do app please" })).status, 200);
  await new Promise((r) => setTimeout(r, 20));

  const kinds = (await store.listEvents(session.id)).map((e) => [e.kind, e.speaker, e.text]);
  assert.deepEqual(kinds, [["join", "Amir", null], ["utterance", "Amir", "a to do app please"]]);
  assert.ok(!JSON.stringify(logs).includes("to do"), "no transcript text in logs");
});

test("local speech is validated, refused once the session ended, and never reachable through a proxy", async () => {
  const { base, app } = await startLocal();
  const session = await newLocalSession(base);
  const url = `${base}/api/sessions/${session.id}/speech`;
  assert.equal((await post(url, { kind: "utterance", speaker: "", text: "hi" })).status, 400);
  assert.equal((await post(url, { kind: "chat", speaker: "Amir", text: "hi" })).status, 400);
  assert.equal((await post(url, { kind: "utterance", speaker: "Amir", text: "x".repeat(5001) })).status, 400);
  assert.equal((await post(url, { kind: "utterance", speaker: "Amir", text: "hi" }, { "x-forwarded-for": "1.2.3.4" })).status, 404);
  assert.equal((await fetch(`${base}/local`, { headers: { "x-forwarded-for": "1.2.3.4" } })).status, 404);
  assert.equal(await (await fetch(`${base}/local`)).text(), "<html>local</html>");

  assert.equal((await fetch(`${base}/api/sessions/${session.id}/leave`, { method: "POST" })).status, 200);
  await app.pollOnce();
  assert.equal((await post(url, { kind: "utterance", speaker: "Amir", text: "hi" })).status, 409);
});

test("the Recall webhook accepts nothing in local mode", async () => {
  const { base, config } = await startLocal();
  const session = await newLocalSession(base);
  const payload = JSON.stringify({ event: "transcript.data", data: { bot: { id: session.bot_id }, data: { words: [{ text: "hi" }] } } });
  const forged = signForTest("whsec_" + Buffer.from("guess").toString("base64"), payload);
  assert.equal((await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: forged })).status, 401);
  assert.ok(config.verificationSecret.startsWith("whsec_"));
});

test("a mic partial while Builder is talking stops Builder (barge-in)", async () => {
  const { base, stops } = await startLocal({ speaking: true });
  const session = await newLocalSession(base);
  await post(`${base}/api/sessions/${session.id}/speech`, { kind: "partial", speaker: "Amir", text: "wait" });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(stops, [session.id]);
});

test("outside local mode the local routes do not exist", async () => {
  const config = loadConfig({
    RECALL_REGION: "us-west-2", RECALL_API_KEY: "k", RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("s").toString("base64"),
    PUBLIC_API_BASE_URL: "https://a.example.com",
  });
  const store = await openStore();
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: async () => Response.json({ id: "b1" }, { status: 201 }) });
  const app = await createApp({ config, store, recall, log: () => {}, indexHtml: "", stageHtml: "", localHtml: "" });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  assert.equal((await fetch(`${base}/local`)).status, 404);
  assert.equal((await fetch(`${base}/api/local/sessions`, { method: "POST" })).status, 404);
  const created = await post(`${base}/api/sessions`, { meeting_url: "https://meet.google.com/abc-defg-hij" });
  const { session } = (await created.json()) as any;
  assert.equal((await post(`${base}/api/sessions/${session.id}/speech`, { kind: "utterance", speaker: "A", text: "hi" })).status, 404);
});
