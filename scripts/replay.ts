// Replays a scripted meeting into a running server as signed Recall realtime webhooks.
//
//   node scripts/replay.ts test/fixtures/sessions/todo-app.json --session <id> [--base-url http://localhost:3000]
//        [--speed 4] [--live-models]
//
// It only sends: it binds no port. The secret comes from RECALL_WEBHOOK_VERIFICATION_SECRET (the same
// one the target server verifies with). With --live-models the server's own models answer, so the
// target must run with OPENROUTER_API_KEY set and that costs real money; without it the fixture's
// `fakeModel` scripts are only meaningful to tests that build the app with a scripted port.
// Never logs transcript text.
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { signForTest } from "../src/verify.ts";
import type { ToolCall } from "../src/agent/llm.ts";

export type FixtureUtterance = { t: number; speaker: string; text: string; partial?: boolean };

export type Fixture = {
  participants: string[];
  utterances: FixtureUtterance[];
  // Quiet time after the last utterance, so silence-based triggers (stuck) can fire.
  tailMs?: number;
  // Scripted model output per loop, for tests that run the app on createRoutedFakePort.
  fakeModel?: { conversation: ToolCall[][]; build: ToolCall[][] };
};

export type ReplayOptions = {
  baseUrl: string;
  sessionId: string;
  secret: string;
  speed?: number;
  liveModels?: boolean;
  // Waits `ms` of scripted time (already divided by speed). Tests pass a virtual clock.
  sleep?: (ms: number) => Promise<void>;
};

const REALTIME_PATH = "/recall/realtime/";
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function replay(fixture: Fixture, opts: ReplayOptions): Promise<{ posted: number }> {
  const speed = opts.speed ?? 1;
  if (!(speed > 0)) throw new Error("speed must be positive");
  const sleep = opts.sleep ?? realSleep;
  // Webhook ids are unique per run, so replaying twice into one server is not deduplicated.
  const run = randomUUID().slice(0, 8);
  const bot = { id: "replay-bot", metadata: { session_id: opts.sessionId } };
  let posted = 0;

  const post = async (event: string, data: Record<string, unknown>) => {
    const payload = JSON.stringify({ event, data: { bot, data } });
    const res = await fetch(new URL(REALTIME_PATH, opts.baseUrl), {
      method: "POST", body: payload,
      headers: { "content-type": "application/json", ...signForTest(opts.secret, payload, `msg_replay_${run}_${posted}`) },
    });
    if (!res.ok) throw new Error(`webhook rejected: ${res.status}`);
    posted++;
  };

  for (const name of fixture.participants) {
    await sleep(0);
    await post("participant_events.join", { participant: { name } });
  }
  let at = 0;
  for (const u of fixture.utterances) {
    await sleep(Math.max(0, u.t - at) / speed);
    at = Math.max(at, u.t);
    await post(u.partial ? "transcript.partial_data" : "transcript.data", {
      participant: { name: u.speaker },
      words: u.text.split(/\s+/).filter(Boolean).map((text) => ({ text })),
    });
  }
  await sleep((fixture.tailMs ?? 0) / speed);
  return { posted };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args[0]?.startsWith("--") ? undefined : args[0];
  const sessionId = flag("--session");
  if (!file || !sessionId) {
    console.error("usage: node scripts/replay.ts <fixture.json> --session <id> [--base-url url] [--speed n] [--live-models]");
    process.exit(2);
  }
  if (existsSync(".env")) process.loadEnvFile(".env");
  const secret = process.env.RECALL_WEBHOOK_VERIFICATION_SECRET;
  if (!secret) throw new Error("RECALL_WEBHOOK_VERIFICATION_SECRET is not set");
  const liveModels = args.includes("--live-models");
  const baseUrl = flag("--base-url") ?? "http://localhost:3000";
  const fixture = JSON.parse(readFileSync(file, "utf8")) as Fixture;
  if (liveModels) console.log("live models: the server's own models answer; this costs real money");
  const started = Date.now();
  const { posted } = await replay(fixture, { baseUrl, sessionId, secret, speed: Number(flag("--speed") ?? 1), liveModels });
  console.log(`replayed ${posted} events into ${baseUrl} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
