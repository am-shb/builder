// Every cost a session runs up is recorded, not only model calls: TTS per spoken line, and Recall's bot time and
// transcription once the bot is done. Recall is a fake fetch and the store is in-memory SurrealDB.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { createApp } from "../src/app.ts";
import { recallCosts, ttsCost, RECALL_BOT_USD_PER_HOUR, RECALL_TRANSCRIPT_USD_PER_HOUR, TTS_USD_PER_CHAR } from "../src/service-costs.ts";
import { OPENROUTER_TTS_MODEL } from "../src/voice/openrouter-tts.ts";
import { testStore } from "./helpers/store.ts";

const TOKEN = "internal-test-token-0123456789abcdef";
const ENV = {
  RECALL_REGION: "us-west-2",
  RECALL_API_KEY: "test-key",
  RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
  PUBLIC_API_BASE_URL: "https://agent.example.com",
  ENGINE_INTERNAL_TOKEN: TOKEN,
};
const T0 = Date.parse("2026-10-19T16:52:02.000Z");
const S = 1000;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

type Change = { code: string; at: number };
const changes = (list: Change[]) => list.map((c) => ({ code: c.code, sub_code: null, message: null, created_at: new Date(c.at).toISOString() }));

// The bot from the 2026-10-19 live test: 2 min in the waiting room, then 4 min 46 s recording.
const LIVE: Change[] = [
  { code: "joining_call", at: T0 },
  { code: "in_waiting_room", at: T0 + 2 * S },
  { code: "in_call_recording", at: T0 + 120 * S },
  { code: "done", at: T0 + 406 * S },
];

test("TTS is priced per character of the line, at the voice model's rate", () => {
  assert.equal(TTS_USD_PER_CHAR[OPENROUTER_TTS_MODEL], 0.00002);
  const c = ttsCost("Want me to add it?", TTS_USD_PER_CHAR[OPENROUTER_TTS_MODEL]!);
  assert.equal(c.chars, 18);
  assert.ok(close(c.usd, 18 * 0.00002));
  assert.equal(ttsCost("café ☕", 1).chars, 6, "characters, not UTF-16 units");
});

test("Recall bills bot time from joining_call to the end, and transcription from recording to the end", () => {
  assert.deepEqual(RECALL_BOT_USD_PER_HOUR, { web: 0.5, web_4_core: 0.6, web_gpu: 1.5 });
  assert.equal(RECALL_TRANSCRIPT_USD_PER_HOUR, 0.15);
  const rows = recallCosts("s1", changes(LIVE), "web_4_core");
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.quantity, r.unit]), [
    ["s1:recall_bot", "recall_bot", 406, "seconds"],
    ["s1:recall_transcript", "recall_transcript", 286, "seconds"],
  ]);
  assert.ok(close(rows[0]!.usd, 406 * 0.6 / 3600));
  assert.ok(close(rows[1]!.usd, 286 * 0.15 / 3600));
  // The plain web bot (BOT_VARIANT=web, config null) is the base rate.
  assert.ok(close(recallCosts("s1", changes(LIVE), null)[0]!.usd, 406 * 0.5 / 3600));
});

test("Recall doesn't bill a bot that ends in fatal, and a bot that never recorded has no transcription", () => {
  assert.deepEqual(recallCosts("s1", changes([{ code: "joining_call", at: T0 }, { code: "fatal", at: T0 + 30 * S }]), "web_4_core"), []);
  const lobbyOnly = recallCosts("s1", changes([
    { code: "joining_call", at: T0 }, { code: "in_waiting_room", at: T0 + S }, { code: "done", at: T0 + 600 * S },
  ]), "web_4_core");
  assert.deepEqual(lobbyOnly.map((r) => [r.kind, r.quantity]), [["recall_bot", 600]], "waiting-room time is billed");
  // The engine stops polling at call_ended, so that is when the bill is taken. Recall's own `done` comes seconds later.
  const ended = recallCosts("s1", changes([...LIVE.slice(0, 3), { code: "call_ended", at: T0 + 400 * S }]), "web_4_core");
  assert.deepEqual(ended.map((r) => r.quantity), [400, 280]);
  // A history without joining_call counts from the first status.
  assert.deepEqual(recallCosts("s1", changes(LIVE.slice(1)), "web_4_core").map((r) => r.quantity), [404, 286]);
});

test("service costs are stored once per id, and the session cost adds them to model spend", async () => {
  const store = await testStore();
  try {
    await store.addModelCall({ sessionId: "a", loop: "build", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.25, ms: 1 });
    await store.addServiceCost({ id: "u1", sessionId: "a", kind: "tts", quantity: 100, unit: "chars", usd: 0.002 });
    await store.addServiceCost({ id: "u1", sessionId: "a", kind: "tts", quantity: 100, unit: "chars", usd: 0.002 });
    for (const r of recallCosts("a", changes(LIVE), "web_4_core")) await store.addServiceCost({ ...r, sessionId: "a" });
    for (const r of recallCosts("a", changes(LIVE), "web_4_core")) await store.addServiceCost({ ...r, sessionId: "a" });
    await store.addServiceCost({ id: "u2", sessionId: "b", kind: "tts", quantity: 50, unit: "chars", usd: 1 });

    const rows = await store.listServiceCosts("a");
    assert.deepEqual(rows.map((r) => [r.id, r.kind, r.quantity, r.unit]), [
      ["u1", "tts", 100, "chars"],
      ["a:recall_bot", "recall_bot", 406, "seconds"],
      ["a:recall_transcript", "recall_transcript", 286, "seconds"],
    ], "a write sent twice is stored once");
    const recall = 406 * 0.6 / 3600 + 286 * 0.15 / 3600;
    const costs = await store.sessionCosts("a");
    assert.ok(close(costs.model, 0.25));
    assert.ok(close(costs.tts, 0.002));
    assert.ok(close(costs.recall, recall));
    assert.ok(close(costs.total, 0.25 + 0.002 + recall));
    assert.ok(close(await store.sessionCost("a"), costs.total), "sessionCost is the total, so maxUsd counts TTS too");
    assert.deepEqual(await store.sessionCosts("none"), { model: 0, tts: 0, recall: 0, total: 0 });
  } finally {
    await store.close();
  }
});

async function startEngine(history: Change[]) {
  const config = loadConfig(ENV);
  const store = await testStore();
  const recall = { history };
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/bot/") && init.method === "POST") return Response.json({ id: "bot-1" }, { status: 201 });
    if (/\/bot\/[^/]+\/$/.test(u) && (init.method ?? "GET") === "GET") return Response.json({ id: "bot-1", status_changes: changes(recall.history) });
    throw new Error(`unexpected Recall call ${init.method} ${u}`);
  }) as typeof fetch;
  const client = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeFetch, sleep: async () => {}, maxAttempts: 1 });
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const app = await createApp({
    config, recall: client, store, clock: () => T0, log: (msg, fields) => logs.push({ msg, fields }),
    indexHtml: "<html></html>", stageHtml: "<html>stage</html>",
  });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sessionId = randomUUID();
  const res = await fetch(`${base}/internal/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ sessionId, orgId: "org_a", meetingUrl: "https://meet.google.com/abc-defg-hij", limits: { maxUsd: 5, maxMinutes: 60 } }),
  });
  assert.equal(res.status, 201);
  return { app, store, recall, logs, sessionId, base };
}

test("when the bot is done, the engine records Recall's costs and logs the session's cost by kind", async () => {
  const e = await startEngine(LIVE.slice(0, 3));
  try {
    await e.app.pollOnce();
    assert.deepEqual(await e.store.listServiceCosts(e.sessionId), [], "nothing is billed while the bot is in the call");

    e.recall.history = LIVE;
    await e.app.pollOnce();
    const rows = await e.store.listServiceCosts(e.sessionId);
    assert.deepEqual(rows.map((r) => [r.kind, r.quantity]), [["recall_bot", 406], ["recall_transcript", 286]]);

    const logged = e.logs.find((l) => l.msg === "session.cost");
    assert.ok(logged, "one line with the session's cost");
    assert.equal(logged.fields?.session_id, e.sessionId);
    assert.ok(close(logged.fields?.recall_usd as number, 406 * 0.6 / 3600 + 286 * 0.15 / 3600));
    assert.equal(logged.fields?.model_usd, 0);
    assert.equal(logged.fields?.tts_usd, 0);
    assert.ok(e.logs.findIndex((l) => l.msg === "session.cost") < e.logs.findIndex((l) => l.msg === "session.ended"));

    const { session } = await (await fetch(`${e.base}/api/sessions/${e.sessionId}`)).json() as { session: { cost_usd: number; costs: Record<string, number> } };
    assert.ok(close(session.cost_usd, session.costs.total!), "the total includes Recall");
    assert.ok(close(session.costs.recall!, 406 * 0.6 / 3600 + 286 * 0.15 / 3600));
    const polled = await (await fetch(`${e.base}/api/sessions/${e.sessionId}/cost`)).json() as { cost_usd: number };
    assert.ok(close(polled.cost_usd, session.cost_usd), "the operator page's poll reads the same total");
  } finally {
    await e.store.close();
  }
});
