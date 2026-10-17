// Entrypoint. `node src/server.ts` runs the real server; `--smoke` boots the
// same app with fake injected config + a fake Recall API and drives it over a
// real loopback socket, then exits.
import http from "node:http";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { createRecallClient } from "./recall-client.ts";
import { openStore } from "./store.ts";
import { createApp, REALTIME_PATH, tokenMatches } from "./app.ts";
import { createRuntime } from "./session/runtime.ts";
import { createStageChannel } from "./stage/channel.ts";
import { signForTest } from "./verify.ts";

async function main() {
  if (process.argv.includes("--smoke")) return smoke();

  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig(process.env);
  const store = openStore(config.dbPath);
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey });
  const server = http.createServer();
  const log = (msg: string, fields?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }));
  let runtime!: ReturnType<typeof createRuntime>;
  const channel = createStageChannel(
    server,
    (id, token) => tokenMatches(token, store.getSession(id)?.stage_token ?? null),
    () => {},
    (id) => runtime(id).snapshot(),
    log,
  );
  runtime = createRuntime({ store, channel, log });
  const app = createApp({ config, recall, store, runtime, log });
  server.on("request", app.handler);

  setInterval(() => void app.pollOnce(), 4000).unref();
  server.listen(config.port, () => {
    console.log(`Listening on http://localhost:${config.port}`);
    console.log(`Recall realtime endpoint: ${config.publicBaseUrl}${REALTIME_PATH} (region ${config.region})`);
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
