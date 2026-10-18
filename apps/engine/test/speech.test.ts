import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { openStore } from "../src/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createStageChannel } from "../src/stage/channel.ts";
import type { StageEvent, StageSink } from "../src/stage/channel.ts";
import { tokenMatches } from "../src/app.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { createFakePort } from "../src/agent/llm.ts";
import { createConversationLoop } from "../src/agent/conversation-loop.ts";
import { createFakeTts, PCM_SAMPLE_RATE } from "../src/voice/tts.ts";
import type { TtsProvider } from "../src/voice/tts.ts";
import { createOpenRouterTts, OPENROUTER_TTS_MODEL } from "../src/voice/openrouter-tts.ts";
import { createSpeech, firstChunkTimeout } from "../src/voice/speech.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };

const servers = new Set<http.Server>();
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

// pcm16le samples 0, 1, 2, ... as bytes.
function pcm(samples: number, from = 0): Uint8Array {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE((from + i) % 32768, i * 2);
  return new Uint8Array(b);
}

type Logged = { msg: string; fields?: Record<string, unknown> };

async function setup(opts: { tts: TtsProvider; channel?: StageSink; timeoutMs?: number; chatFails?: boolean }) {
  const store = await openStore();
  const sessionId = randomUUID();
  await store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  await store.markCreated(sessionId, "bot-1");
  const sent: StageEvent[] = [];
  const frames: { utteranceId: string; pcm: Uint8Array }[] = [];
  const timeline: string[] = [];
  const channel: StageSink = opts.channel ?? {
    send: (_id, ev) => { sent.push(ev); timeline.push(ev.type); },
    sendAudio: (_id, utteranceId, data) => { frames.push({ utteranceId, pcm: data }); timeline.push("audio"); },
    clients: () => 1,
  };
  const runtime = createRuntime({ store, channel });
  const chats: { botId: string; message: string }[] = [];
  const recall = {
    sendChatMessage: async (botId: string, message: string) => {
      if (opts.chatFails) throw new Error("chat down");
      chats.push({ botId, message });
    },
  };
  const logs: Logged[] = [];
  const speech = createSpeech({
    tts: opts.tts, runtime, recall, store, channel, log: (msg, fields) => logs.push({ msg, fields }),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const mood = () => (runtime(sessionId).snapshot() as Extract<StageEvent, { type: "snapshot" }>).mood;
  return { store, sessionId, sent, frames, timeline, runtime, chats, logs, speech, mood };
}

// A provider that yields `first` chunks, then waits until aborted (or forever, if it ignores the signal).
function heldTts(first: Uint8Array[], honoursSignal = true) {
  const seen: { signal: AbortSignal | null; text: string | null; returned: boolean } = { signal: null, text: null, returned: false };
  const tts: TtsProvider = {
    async *stream(text, signal) {
      seen.signal = signal;
      seen.text = text;
      try {
        for (const c of first) yield c;
        await new Promise<void>((resolve) => { if (honoursSignal) signal.addEventListener("abort", () => resolve()); });
        if (signal.aborted) throw signal.reason;
      } finally {
        seen.returned = true;
      }
    },
  };
  return { tts, seen };
}

// A real stage channel on a loopback server, and a ws client connected to it.
async function stageWithClient() {
  const store = await openStore();
  const sessionId = randomUUID();
  await store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  await store.markCreated(sessionId, "bot-1");
  const token = await store.ensureStageToken(sessionId);
  const server = http.createServer();
  servers.add(server);
  let runtime!: ReturnType<typeof createRuntime>;
  const channel = createStageChannel(server, async (id, t) => tokenMatches(t, (await store.getSession(id))?.stage_token ?? null), () => {}, (id) => runtime(id).snapshot());
  runtime = createRuntime({ store, channel });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stage/${sessionId}/ws?token=${token}`);
  const received: ({ json: any } | { binary: Buffer })[] = [];
  ws.on("message", (data, isBinary) => received.push(isBinary ? { binary: data as Buffer } : { json: JSON.parse(String(data)) }));
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  return { store, sessionId, channel, runtime, ws, received };
}

// ---------- createSpeech ----------

test("say streams start→audio→end to stage and flags an agent caption without its text", async () => {
  const stage = await stageWithClient();
  // Odd-sized chunks: frames must still carry whole 16-bit samples.
  const all = pcm(2400);
  const chunks = [all.subarray(0, 1001), all.subarray(1001, 3001), all.subarray(3001)];
  const chats: string[] = [];
  const logs: Logged[] = [];
  const speech = createSpeech({
    tts: createFakeTts(chunks, { delayMs: 5 }), runtime: stage.runtime, channel: stage.channel, store: stage.store,
    recall: { sendChatMessage: async (_b: string, m: string) => { chats.push(m); } }, log: (msg, fields) => logs.push({ msg, fields }),
  });
  await sleep(50); // the snapshot
  const said = speech.say(stage.sessionId, "A sidebar could work.");
  await flush();
  assert.equal(speech.speaking(stage.sessionId), true, "speaking while the line streams");
  const utteranceId = await said;
  assert.match(utteranceId, /^[0-9a-f-]{36}$/);
  await sleep(50);

  const kinds = stage.received.map((m) => ("json" in m ? m.json.type : "audio"));
  const start = kinds.indexOf("speech_start");
  const end = kinds.indexOf("speech_end");
  assert.ok(start >= 0 && end > start, `start before end: ${kinds}`);
  const audio = kinds.map((k, i) => (k === "audio" ? i : -1)).filter((i) => i >= 0);
  assert.ok(audio.length >= 1 && audio.every((i) => i > start && i < end), `audio between start and end: ${kinds}`);

  const startEv = (stage.received[start] as { json: any }).json;
  assert.deepEqual(startEv, { type: "speech_start", utteranceId }, "the line itself never goes to the stage");
  assert.deepEqual((stage.received[end] as { json: any }).json, { type: "speech_end", utteranceId });
  const bodies = audio.map((i) => (stage.received[i] as { binary: Buffer }).binary);
  for (const b of bodies) {
    assert.equal(b.subarray(0, 36).toString("ascii"), utteranceId);
    assert.equal((b.length - 36) % 2, 0, "whole samples per frame");
  }
  assert.deepEqual(Buffer.concat(bodies.map((b) => b.subarray(36))), Buffer.from(all), "the PCM arrives intact and in order");

  const captions = stage.received.flatMap((m) => ("json" in m && m.json.type === "caption" ? [m.json.caption] : []));
  assert.deepEqual(captions, [{ partial: false, isAgent: true }]);
  assert.ok(!stage.received.some((m) => "json" in m && JSON.stringify(m.json).includes("sidebar")), "no stage message carries the line");
  const moods = stage.received.flatMap((m) => ("json" in m && m.json.type === "mood" ? [m.json.mood] : []));
  assert.equal(moods[0], "speaking");
  assert.deepEqual(chats, [], "no chat when the voice works");

  // Speaking lasts as long as the stage plays the audio (2400 samples = 100 ms), then ends.
  await sleep(2400 / PCM_SAMPLE_RATE * 1000 + 400);
  assert.equal(speech.speaking(stage.sessionId), false);
  assert.equal(stage.received.flatMap((m) => ("json" in m && m.json.type === "mood" ? [m.json.mood] : [])).at(-1), "listening");

  // Logs carry ids and counts, never the line.
  assert.ok(logs.some((l) => l.msg === "speech.done" && l.fields?.bytes === all.length && l.fields?.utterance_id === utteranceId));
  assert.ok(!JSON.stringify(logs).includes("sidebar"), "no spoken text in logs");
  stage.ws.close();
});

test("stop aborts the provider stream and sends speech_stop", async () => {
  const { tts, seen } = heldTts([pcm(480)]);
  const s = await setup({ tts });
  const said = s.speech.say(s.sessionId, "Let me think about that.");
  await flush();
  assert.equal(s.frames.length, 1);
  assert.equal(s.speech.speaking(s.sessionId), true);
  assert.equal(s.mood(), "speaking");

  s.speech.stop(s.sessionId);
  assert.equal(seen.signal?.aborted, true, "the provider request is aborted");
  assert.equal(s.speech.speaking(s.sessionId), false, "stops at once");
  assert.deepEqual(s.sent.filter((e) => e.type.startsWith("speech_")).map((e) => e.type), ["speech_start", "speech_stop"]);
  const id = await said;
  assert.equal(id, s.frames[0].utteranceId, "say resolves to the interrupted utterance");
  await flush();
  assert.equal(seen.returned, true, "the provider iterator is closed");
  assert.equal(s.frames.length, 1, "no audio after the stop");
  assert.notEqual(s.mood(), "speaking");
  assert.deepEqual(s.chats, [], "an interruption is not a failure: no chat");
  assert.ok(s.logs.some((l) => l.msg === "speech.stopped"));
  s.speech.stop(s.sessionId); // idempotent
});

test("stop is instant even when the provider ignores the abort signal", async () => {
  const { tts } = heldTts([pcm(480)], false);
  const s = await setup({ tts });
  const said = s.speech.say(s.sessionId, "Hm.");
  await flush();
  s.speech.stop(s.sessionId);
  const r = await Promise.race([said.then(() => "resolved"), sleep(200).then(() => "hung")]);
  assert.equal(r, "resolved");
  assert.equal(s.speech.speaking(s.sessionId), false);
});

test("tts failure falls back to chat", async () => {
  // The provider throws.
  const broken: TtsProvider = { async *stream() { throw new Error("upstream 502"); } };
  const a = await setup({ tts: broken });
  const long = "y".repeat(600);
  await a.speech.say(a.sessionId, long);
  assert.deepEqual(a.chats.map((c) => [c.botId, c.message.length]), [["bot-1", 500]], "posted to meeting chat within the Meet limit");
  assert.equal(a.speech.speaking(a.sessionId), false);
  assert.notEqual(a.mood(), "speaking");
  assert.ok(a.sent.some((e) => e.type === "caption" && e.caption.isAgent), "the agent caption is still emitted");
  assert.ok(a.logs.some((l) => l.msg === "speech.fallback" && l.fields?.reason === "error"));
  assert.equal((await a.store.listEvents(a.sessionId)).filter((e) => e.kind === "bot_chat").length, 1, "the chat line is recorded");

  // The provider never answers: after timeoutMs the line goes to chat and say resolves.
  const { tts, seen } = heldTts([]);
  const b = await setup({ tts, timeoutMs: 60 });
  const t0 = Date.now();
  await b.speech.say(b.sessionId, "Want me to add it?");
  const took = Date.now() - t0;
  assert.ok(took >= 50 && took < 1000, `resolved after the timeout: ${took} ms`);
  assert.equal(seen.signal?.aborted, true, "the stalled request is aborted");
  assert.deepEqual(b.chats.map((c) => c.message), ["Want me to add it?"]);
  assert.equal(b.speech.speaking(b.sessionId), false);
  assert.ok(b.logs.some((l) => l.msg === "speech.fallback" && l.fields?.reason === "timeout"));
  assert.ok(b.sent.some((e) => e.type === "speech_stop") || !b.sent.some((e) => e.type === "speech_start"), "the stage is never left mid-utterance");

  // A stream that stalls mid-line: the stage is told to stop, and the whole line goes to chat.
  const stalled = heldTts([pcm(480)]);
  const d = await setup({ tts: stalled.tts, timeoutMs: 60 });
  await d.speech.say(d.sessionId, "Half a line.");
  assert.deepEqual(d.sent.filter((e) => e.type.startsWith("speech_")).map((e) => e.type), ["speech_start", "speech_stop"]);
  assert.deepEqual(d.chats.map((c) => c.message), ["Half a line."]);
  assert.equal(d.speech.speaking(d.sessionId), false);

  // If chat fails too, say rejects (the loop logs speak.failed and carries on).
  const c = await setup({ tts: broken, chatFails: true });
  await assert.rejects(c.speech.say(c.sessionId, "Hello."));
  assert.equal(c.speech.speaking(c.sessionId), false);
});

test("tts failure falls back to chat without blocking the conversation loop", async () => {
  const { tts } = heldTts([]);
  const s = await setup({ tts, timeoutMs: 60 });
  const requests: number[] = [];
  const inner = createFakePort([
    [{ name: "speak", input: { text: "I think a sidebar fits.", reason: "answer" } }],
    [],
  ]);
  const loop = createConversationLoop({
    port: { runTools(req) { requests.push(1); return inner.runTools(req); } },
    runtime: s.runtime, store: s.store, speech: s.speech, clock: Date.now,
    buildLoop: { handoff() {} },
  });
  const utter = async (text: string) => {
    const e = (await s.store.addEvent({ sessionId: s.sessionId, recallMsgId: null, kind: "utterance", speaker: "Amir", text }))!;
    loop.onUtterance(s.sessionId, { id: e.id, speaker: "Amir", text });
  };
  await utter("Hey Builder, what do you think about a sidebar?");
  await sleep(300);
  assert.deepEqual(s.chats.map((c) => c.message), ["I think a sidebar fits."], "the line reached the room by chat");
  await utter("Okay, let's do it.");
  await sleep(100);
  assert.equal(requests.length, 2, "the next turn ran");
});

test("a long line gets longer for its first audio, up to twice the gap allowed between chunks (known issue M5)", async () => {
  assert.equal(firstChunkTimeout(""), 4000);
  assert.equal(firstChunkTimeout("x".repeat(100)), 5500);
  assert.equal(firstChunkTimeout("x".repeat(300)), 8000);
  assert.equal(firstChunkTimeout("x".repeat(20), 60), 120);

  // The provider takes longer than the gap allowed between chunks to start this line: it is still heard.
  const slow: TtsProvider = { async *stream() { await sleep(280); yield pcm(480); } };
  const s = await setup({ tts: slow, timeoutMs: 200 });
  const line = "A longer line, which takes the provider a moment.";
  assert.ok(firstChunkTimeout(line, 200) >= 380);
  await s.speech.say(s.sessionId, line);
  assert.deepEqual(s.chats, [], "spoken, not sent to chat");
  assert.equal(s.frames.length, 1);
  assert.ok(!s.logs.some((l) => l.msg === "speech.fallback"));
});

// ---------- OpenRouter provider (local fake server; never the network) ----------

async function fakeOpenRouter(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    handler(req, body, res);
  });
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1` };
}

test("openrouter tts posts the whole line and yields pcm chunks as they arrive", async () => {
  const seen: { method?: string; url?: string; auth?: string; type?: string; body?: any } = {};
  let finishedAt = 0;
  const { baseUrl } = await fakeOpenRouter((req, body, res) => {
    Object.assign(seen, { method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "audio/pcm", "X-Generation-Id": "gen-1" });
    res.write(Buffer.from(pcm(240)));
    setTimeout(() => res.write(Buffer.from(pcm(240, 240))), 150);
    setTimeout(() => { finishedAt = Date.now(); res.end(Buffer.from(pcm(240, 480))); }, 300);
  });
  const tts = createOpenRouterTts({ apiKey: "sk-or-test", voice: "george", model: OPENROUTER_TTS_MODEL, baseUrl });
  const got: Buffer[] = [];
  let firstAt = 0;
  for await (const chunk of tts.stream("Hello there.", new AbortController().signal)) {
    if (!got.length) firstAt = Date.now();
    got.push(Buffer.from(chunk));
  }
  assert.equal(OPENROUTER_TTS_MODEL, "elevenlabs/eleven-v4-turbo");
  assert.deepEqual(
    { method: seen.method, url: seen.url, auth: seen.auth, type: seen.type },
    { method: "POST", url: "/api/v1/audio/speech", auth: "Bearer sk-or-test", type: "application/json" },
  );
  assert.deepEqual(seen.body, { model: "elevenlabs/eleven-v4-turbo", input: "Hello there.", voice: "george", response_format: "pcm" });
  assert.ok(got.length >= 2, "streamed in more than one chunk");
  assert.ok(firstAt < finishedAt, "the first chunk is yielded before the response ends");
  assert.deepEqual(Buffer.concat(got), Buffer.from(pcm(720)));
});

test("openrouter tts: aborting mid-stream stops iteration and closes the request", async () => {
  let closed!: () => void;
  const requestClosed = new Promise<void>((r) => (closed = r));
  const { baseUrl } = await fakeOpenRouter((_req, _body, res) => {
    res.writeHead(200, { "Content-Type": "audio/pcm" });
    const timer = setInterval(() => res.write(Buffer.from(pcm(240))), 20);
    res.on("close", () => { clearInterval(timer); closed(); });
  });
  const tts = createOpenRouterTts({ apiKey: "k", voice: "george", model: OPENROUTER_TTS_MODEL, baseUrl });
  const ac = new AbortController();
  let chunks = 0;
  await assert.rejects(async () => {
    for await (const _ of tts.stream("A long line.", ac.signal)) {
      if (++chunks === 2) ac.abort();
    }
  }, (err: Error) => err.name === "AbortError");
  assert.equal(chunks, 2, "no chunks after the abort");
  await Promise.race([requestClosed, sleep(2000).then(() => assert.fail("request not closed"))]);
});

test("openrouter tts: an error status throws without the response body", async () => {
  const { baseUrl } = await fakeOpenRouter((_req, _body, res) => {
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Insufficient credits", code: 402 } }));
  });
  const tts = createOpenRouterTts({ apiKey: "k", voice: "george", model: OPENROUTER_TTS_MODEL, baseUrl });
  await assert.rejects(async () => { for await (const _ of tts.stream("Hi.", new AbortController().signal)); }, (err: Error & { status?: number }) => {
    assert.equal(err.status, 402);
    assert.ok(!err.message.includes("Hi."));
    return true;
  });
});

// ---------- Recall: Builder's own voice is never transcribed ----------

test("createBot never sets include_bot_in_recording", async () => {
  const bodies: string[] = [];
  const recall = createRecallClient({
    region: "us-west-2", apiKey: "k", sleep: async () => {},
    fetch: (async (_url: string, init: RequestInit) => { bodies.push(String(init.body)); return Response.json({ id: "bot-1" }, { status: 201 }); }) as typeof fetch,
  });
  await recall.createBot({ meetingUrl: "https://meet.google.com/abc-defg-hij", botName: "Builder", realtimeWebhookUrl: "https://agent.example.com/recall/realtime/", screenshareUrl: "https://agent.example.com/stage/x", variant: "web_4_core", metadata: {} });
  assert.equal(bodies.length, 1);
  assert.ok(!bodies[0].includes("include_bot_in_recording"), "bot audio stays out of the recording (Recall default)");
});
