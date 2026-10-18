// Entrypoint. `node src/server.ts` runs the real server; `--smoke` boots the
// same app with fake injected config + a fake Recall API and drives it over a
// real loopback socket, then exits.
import http from "node:http";
import { existsSync } from "node:fs";
import { loadConfig, loadLocalConfig } from "./config.ts";
import { createRecallClient } from "./recall-client.ts";
import { createLocalRecall } from "./local-recall.ts";
import { openStore } from "./store.ts";
import { createApp, REALTIME_PATH, tokenMatches } from "./app.ts";
import { createRuntime, handleStageMessage } from "./session/runtime.ts";
import { createStageChannel } from "./stage/channel.ts";
import { createOpenRouterPort } from "./agent/llm.ts";
import { createOpenRouterTts, OPENROUTER_TTS_MODEL } from "./voice/openrouter-tts.ts";
import { createSpeech } from "./voice/speech.ts";
import { signForTest } from "./verify.ts";

async function main() {
  if (process.argv.includes("--smoke")) return smoke();

  if (existsSync(".env")) process.loadEnvFile(".env");
  // --local: no Recall and no meeting. You talk into your own mic on /local (docs/adr/0003-local-mode.md).
  const config = process.argv.includes("--local") ? loadLocalConfig(process.env) : loadConfig(process.env);
  if (!config.agentEnabled) console.warn("OPENROUTER_API_KEY is not set: running listen-only (no agent replies or prototype building).");
  const log = (msg: string, fields?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }));
  // Last resort. Logs the error's name and stack frames, never its message (which can quote meeting
  // content), then exits so the process supervisor starts a clean process.
  process.on("uncaughtException", (err) => {
    const e = err instanceof Error ? err : null;
    const frames = (e?.stack ?? "").split("\n").map((f) => f.trim()).filter((f) => f.startsWith("at ")).slice(0, 8);
    log("process.uncaught", { error: e?.name ?? "unknown", frames });
    process.exit(1);
  });
  const store = openStore(config.dbPath, { log });
  const recall = config.local ? createLocalRecall() : createRecallClient({ region: config.region, apiKey: config.apiKey });
  const server = http.createServer();
  let runtime!: ReturnType<typeof createRuntime>;
  let voice: { stop(sessionId: string): void } | undefined; // Builder's voice, once configured
  const channel = createStageChannel(
    server,
    (id, token) => tokenMatches(token, store.getSession(id)?.stage_token ?? null),
    (id, msg) => handleStageMessage(runtime, id, msg, (sid) => {
      log("barge_in", { session_id: sid, source: "stage" });
      voice?.stop(sid);
    }),
    (id) => runtime(id).snapshot(),
    log,
  );
  runtime = createRuntime({ store, channel, log });
  // Builder speaks through the stage when a voice is configured; otherwise its lines go to meeting chat.
  if (config.agentEnabled && !config.ttsVoice) console.warn("TTS_VOICE is not set: Builder's lines go to meeting chat instead of voice.");
  const speech = config.agentEnabled && config.ttsVoice ? createSpeech({
    tts: createOpenRouterTts({ apiKey: config.openrouterApiKey!, voice: config.ttsVoice, model: OPENROUTER_TTS_MODEL }),
    runtime, recall, store, channel, log,
  }) : undefined;
  voice = speech;
  const agent = config.agentEnabled ? { port: createOpenRouterPort(config, { log }), ...(speech ? { speech } : {}) } : undefined;
  const app = createApp({ config, recall, store, runtime, log, agent });
  server.on("request", app.handler);

  setInterval(() => void app.pollOnce(), 4000).unref();
  if (agent) setInterval(() => app.tickAgent(), 1000).unref();
  server.listen(config.port, () => {
    console.log(`Listening on http://localhost:${config.port}`);
    if (config.local) console.log(`Local mode, no Recall: open http://localhost:${config.port}/local in Chrome`);
    else console.log(`Recall realtime endpoint: ${config.publicBaseUrl}${REALTIME_PATH} (region ${config.region})`);
  });
}

async function smoke() {
  const secret = "whsec_" + Buffer.from("smoke-test-secret-not-real").toString("base64");
  const config = loadConfig({
    RECALL_REGION: "us-west-2",
    RECALL_API_KEY: "fake-key",
    RECALL_WEBHOOK_VERIFICATION_SECRET: secret,
    PUBLIC_API_BASE_URL: "https://smoke.example.com",
  });
  const fakeRecall: typeof fetch = async (input) => {
    const u = String(input);
    if (u.endsWith("/bot/")) return Response.json({ id: "bot-smoke-1" }, { status: 201 });
    return Response.json({ id: "bot-smoke-1", status_changes: [{ code: "in_call_recording", sub_code: null, message: null, created_at: "" }] });
  };
  const store = openStore(":memory:");
  const app = createApp({ config, store, recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeRecall }), log: () => {} });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const created = await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: "https://meet.google.com/abc-defg-hij" }) });
  const { session } = (await created.json()) as any;
  if (created.status !== 201 || session.bot_id !== "bot-smoke-1") throw new Error("create failed");

  const payload = JSON.stringify({
    event: "transcript.data",
    data: { bot: { id: "bot-smoke-1", metadata: { session_id: session.id } }, data: { participant: { name: "Smoke Speaker" }, words: [{ text: "hello" }, { text: "world" }] } },
  });
  const bad = await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: { "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,AAAA" } });
  const good = await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: signForTest(secret, payload) });
  await new Promise((r) => setTimeout(r, 50));
  await app.pollOnce();
  const view = (await (await fetch(`${base}/api/sessions/${session.id}`)).json()) as any;
  server.close();

  const ok = bad.status === 401 && good.status === 200 &&
    view.session.events[0]?.text === "hello world" && view.session.bot_status === "in_call_recording";
  console.log(ok ? "SMOKE OK: create bot -> verified realtime utterance -> status visible" : "SMOKE FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
