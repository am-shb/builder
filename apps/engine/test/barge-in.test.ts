import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { testStore } from "./helpers/store.ts";
import { createRuntime, handleStageMessage } from "../src/session/runtime.ts";
import { createFakePort } from "../src/agent/llm.ts";
import { createConversationLoop } from "../src/agent/conversation-loop.ts";
import { withStage } from "./helpers/stage.ts";
import { createFakeTts, PCM_SAMPLE_RATE } from "../src/voice/tts.ts";
import { createSpeech } from "../src/voice/speech.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.UTC(2026, 0, 1);

async function loopWith(speaking: boolean) {
  const store = await testStore();
  const runtime = createRuntime({ store, channel: { send() {}, sendAudio() {}, clients: () => 0 } });
  const stops: string[] = [];
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const loop = createConversationLoop({
    port: createFakePort([]), runtime, store, clock: () => T0, log: (msg, fields) => logs.push({ msg, fields }),
    buildLoop: { handoff() {} }, speech: { say: async () => "u", stop: (id) => void stops.push(id), speaking: () => speaking },
  });
  return { loop, stops, logs, sid: randomUUID() };
}

test("human partial during speech stops speech (server fallback)", async () => {
  const s = await loopWith(true);
  s.loop.onPartial(s.sid, { speaker: "Sara", text: "wait" });
  assert.deepEqual(s.stops, [s.sid]);
  assert.ok(s.logs.some((l) => l.msg === "barge_in" && l.fields?.session_id === s.sid));
  assert.ok(!JSON.stringify(s.logs).includes("wait"), "no transcript text in logs");
});

test("Builder's own partial, an empty partial, or a quiet room does not stop speech", async () => {
  const s = await loopWith(true);
  s.loop.onPartial(s.sid, { speaker: "Builder", text: "so the sidebar" });
  s.loop.onPartial(s.sid, { speaker: "Sara", text: "" });
  s.loop.onPartial(s.sid, { speaker: "Sara", text: null });
  assert.deepEqual(s.stops, []);
  const quiet = await loopWith(false);
  quiet.loop.onPartial(quiet.sid, { speaker: "Sara", text: "hello" });
  assert.deepEqual(quiet.stops, []);
});

test("a barge_in stage message calls the barge-in handler; malformed ones do not", async () => {
  const store = await testStore();
  const runtime = createRuntime({ store, channel: { send() {}, sendAudio() {}, clients: () => 0 } });
  const got: string[] = [];
  handleStageMessage(runtime, "s1", { type: "barge_in" }, (id) => got.push(id));
  handleStageMessage(runtime, "s1", { type: "barge_in_x" }, (id) => got.push(id));
  handleStageMessage(runtime, "s1", null, (id) => got.push(id));
  assert.deepEqual(got, ["s1"]);
  assert.doesNotThrow(() => handleStageMessage(runtime, "s1", { type: "barge_in" }));
});

function tone(seconds: number): Uint8Array[] {
  const total = Math.round(seconds * PCM_SAMPLE_RATE);
  const per = PCM_SAMPLE_RATE / 10;
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < total; start += per) {
    const b = Buffer.alloc(Math.min(per, total - start) * 2);
    for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 220 * (start + i)) / PCM_SAMPLE_RATE)), i * 2);
    chunks.push(new Uint8Array(b));
  }
  return chunks;
}

test("stage stops audio within 300ms of a human transcript message and notifies server", { timeout: 60_000 }, async (t) => {
  const fake = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const sockets = new Set<WebSocket>();
  fake.on("connection", (ws) => { sockets.add(ws); ws.on("close", () => sockets.delete(ws)); });
  const port = await new Promise<number>((r) => fake.on("listening", () => r((fake.address() as any).port)));
  try {
    await withStage(t, async ({ page, runtime, channel, store, sessionId, bargeIns }) => {
      const href = await page.eval<string>(`location.href`);
      await page.goto(`${href}&meetingData=ws://127.0.0.1:${port}`);
      await page.waitFor(`window.stageVoice && document.querySelector('[data-node-id="home"]')`);
      const t0 = Date.now();
      while (sockets.size === 0 && Date.now() - t0 < 5000) await sleep(20);
      assert.equal(sockets.size, 1, "stage connected to the meeting-data socket");
      const send = (m: unknown) => { for (const s of sockets) s.send(JSON.stringify(m)); };

      const speech = createSpeech({
        tts: createFakeTts(tone(6), { delayMs: 30 }), runtime, channel, store,
        recall: { sendChatMessage: async () => {} },
      });
      const said = speech.say(sessionId, "A sidebar could work here.");
      await page.waitFor(`window.stageVoice.level() > 0.4`, 3000);

      // Builder's own words and empty words do nothing.
      send({ transcript: { speaker: "Builder", words: [{ text: "so" }] } });
      send({ transcript: { speaker: "Sara", words: [] } });
      await sleep(300);
      assert.ok(await page.eval<number>(`window.stageVoice.level()`) > 0.4, "still speaking");
      assert.deepEqual(bargeIns, []);

      const s0 = Date.now();
      send({ transcript: { participant: { name: "Sara" }, words: [{ text: "wait" }] } });
      await page.waitFor(`window.stageVoice.level() < 0.01`, 1000);
      const stoppedMs = Date.now() - s0;
      while (bargeIns.length === 0 && Date.now() - s0 < 1000) await sleep(5);
      const notifiedMs = Date.now() - s0;
      console.log(`barge-in: stage silent ${stoppedMs} ms, server notified ${notifiedMs} ms after the human message`);
      assert.ok(stoppedMs < 300, `stage stops within 300ms: ${stoppedMs}`);
      assert.deepEqual(bargeIns, [sessionId]);
      assert.ok(notifiedMs < 300, `server notified within 300ms: ${notifiedMs}`);
      speech.stop(sessionId);
      await said;
    });
  } finally {
    for (const s of sockets) s.terminate();
    fake.close();
  }
});

test("without a meeting-data socket the stage works and retries with backoff", { timeout: 60_000 }, async (t) => {
  const fake = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const port = await new Promise<number>((r) => fake.on("listening", () => r((fake.address() as any).port)));
  await new Promise((r) => fake.close(r)); // nothing listens on that port any more
  await withStage(t, async ({ page }) => {
    const href = await page.eval<string>(`location.href`);
    await page.goto(`${href}&meetingData=ws://127.0.0.1:${port}`);
    await page.waitFor(`document.querySelector('[data-node-id="home"]')`);
    await sleep(2500);
    assert.equal(await page.eval(`typeof window.stageVoice.level()`), "number");
  });
});

test("the meetingData override is ignored unless it points at a loopback host", { timeout: 60_000 }, async (t) => {
  const fake = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const hits: number[] = [];
  fake.on("connection", () => hits.push(1));
  const port = await new Promise<number>((r) => fake.on("listening", () => r((fake.address() as any).port)));
  try {
    await withStage(t, async ({ page }) => {
      const href = await page.eval<string>(`location.href`);
      // 127.0.0.1.evil.test is not a loopback host even though it starts with one.
      await page.goto(`${href}&meetingData=${encodeURIComponent(`ws://127.0.0.1.evil.test:${port}`)}`);
      await page.waitFor(`document.querySelector('[data-node-id="home"]')`);
      assert.equal(await page.eval(`window.stageMeetingDataUrl`), null);
      await sleep(500);
      assert.deepEqual(hits, []);
    });
  } finally {
    fake.close();
  }
});
