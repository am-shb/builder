// Entrypoint. `node src/server.ts` runs the real server; `--smoke` boots the
// same app with fake injected config + a fake Recall API and drives it over a
// real loopback socket, then exits.
import http from "node:http";
import { existsSync } from "node:fs";
import { loadConfig, loadLocalConfig } from "./config.ts";
import { createRecallClient } from "./recall-client.ts";
import { createLocalRecall } from "./local-recall.ts";
import { openStore } from "./store.ts";
import { errorCode } from "./error-code.ts";
import { createApp, REALTIME_PATH, tokenMatches } from "./app.ts";
import { createRuntime, handleStageMessage } from "./session/runtime.ts";
import { createStageChannel } from "./stage/channel.ts";
import { createOpenRouterPort } from "./agent/llm.ts";
import { createOpenRouterTts, OPENROUTER_TTS_MODEL } from "./voice/openrouter-tts.ts";
import { createSpeech } from "./voice/speech.ts";
import { TTS_USD_PER_CHAR } from "./service-costs.ts";
import { signForTest } from "./verify.ts";
import { createStatusReporter, SWEEP_WINDOW_MS } from "./api-events.ts";

const SHUTDOWN_GRACE_MS = 25_000;

// The settings errors name the variable that is wrong, never its value, so they are shown as they are.
function loadSettings() {
  try {
    return process.argv.includes("--local") ? loadLocalConfig(process.env) : loadConfig(process.env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes("--smoke")) return smoke();

  if (existsSync(".env")) process.loadEnvFile(".env");
  // --local: no Recall and no meeting. You talk into your own mic on /local (docs/adr/0003-local-mode.md).
  const config = loadSettings();
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
  // The SurrealDB server in SURREAL_URL (migrated by `npm run migrate`), otherwise SurrealDB in this process, in
  // the SurrealKV folder config.surreal.path. A server that can't be reached, or refuses the sign-in, stops the
  // start with its code (SURREAL_UNREACHABLE, NotAllowed.Auth, ...).
  const store = await openStore(config.surreal.url ? { ...config.surreal, log } : { path: config.surreal.path, log }).catch((err) => {
    log("store.connect_failed", { error: errorCode(err) });
    process.exit(1);
  });
  const recall = config.local ? createLocalRecall() : createRecallClient({ region: config.region, apiKey: config.apiKey });
  const server = http.createServer();
  let runtime!: ReturnType<typeof createRuntime>;
  let voice: { stop(sessionId: string): void } | undefined; // Builder's voice, once configured
  const channel = createStageChannel(
    server,
    // Loads the session's runtime before the socket opens, so the first thing the stage gets is its snapshot.
    async (id, token) => {
      if (!tokenMatches(token, (await store.getSession(id))?.stage_token ?? null)) return false;
      await runtime.load(id);
      return true;
    },
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
    usdPerChar: TTS_USD_PER_CHAR[OPENROUTER_TTS_MODEL]!,
    runtime, recall, store, channel, log,
  }) : undefined;
  voice = speech;
  const agent = config.agentEnabled ? { port: createOpenRouterPort(config, { log }), ...(speech ? { speech } : {}) } : undefined;
  // Session status events to the api (A2), only when API_INTERNAL_URL is set (it requires the token).
  const reporter = config.apiInternalUrl && config.internalToken
    ? createStatusReporter({ apiUrl: config.apiInternalUrl, token: config.internalToken, store, log })
    : null;
  const app = await createApp({ config, recall, store, runtime, log, agent, ...(reporter ? { onStatusChange: reporter.notify } : {}) });
  server.on("request", app.handler);

  const poll = setInterval(() => void app.pollOnce(), 4000).unref();
  const report = reporter ? setInterval(() => void reporter.flush(), 2000).unref() : undefined;
  if (reporter) void reporter.sweep(new Date(Date.now() - SWEEP_WINDOW_MS));
  log("api_events.config", { enabled: reporter !== null });
  const tick = agent ? setInterval(() => app.tickAgent(), 1000).unref() : undefined;
  // On Ctrl-C or a platform stop (every deploy sends SIGTERM): take no new requests, finish the events already
  // answered and the saves they led to, then close the store once its queries in flight are done (known issue R3).
  // That also leaves an in-process SurrealKV folder whole. Each query has its own deadline (R4); past
  // SHUTDOWN_GRACE_MS the process exits anyway, inside the 30 s Render waits before it kills the process.
  const shutdown = () => {
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
    clearInterval(poll);
    clearInterval(tick);
    clearInterval(report);
    server.close();
    log("process.shutdown");
    app.drain()
      .catch((err) => log("app.drain_failed", { error: errorCode(err) }))
      .then(() => store.close())
      .catch((err) => log("store.close_failed", { error: errorCode(err) }))
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
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
  const store = await openStore();
  const app = await createApp({ config, store, recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeRecall }), log: () => {} });
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
  await store.close();

  const ok = bad.status === 401 && good.status === 200 &&
    view.session.events[0]?.text === "hello world" && view.session.bot_status === "in_call_recording";
  console.log(ok ? "SMOKE OK: create bot -> verified realtime utterance -> status visible" : "SMOKE FAILED");
  process.exit(ok ? 0 : 1);
}

// A startup failure past the settings (a database read while the app loads, say) is logged by code only: its
// message can quote stored values. Settings errors are reported by loadSettings() with their message.
main().catch((err) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), msg: "process.start_failed", error: errorCode(err) }));
  process.exit(1);
});
