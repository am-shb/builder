import { test } from "node:test";
import assert from "node:assert/strict";
import { withStage } from "./helpers/stage.ts";
import { createFakeTts, PCM_SAMPLE_RATE } from "../src/voice/tts.ts";
import { createSpeech } from "../src/voice/speech.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `seconds` of a 220 Hz tone at amplitude 0.3 (RMS ~0.21), as pcm16le, in 100 ms chunks.
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

const MOUTH_SCALE = `(() => {
  const m = getComputedStyle(document.querySelector(".bot-mouth.open")).transform;
  return m === "none" ? 1 : Number(m.slice(7, -1).split(",")[3]);
})()`;

test("the stage plays streamed PCM, its mouth follows the voice, and stop cuts it at once", { timeout: 60_000 }, async (t) => {
  await withStage(t, async ({ page, runtime, channel, store, sessionId }) => {
    await page.setCpuThrottle(2);
    await page.eval(`import("@renderer/clock.js").then((m) => { window.__ticks = []; m.onFrame((now) => window.__ticks.push(now)); })`);
    const chats: string[] = [];
    const speech = createSpeech({
      tts: createFakeTts(tone(6), { delayMs: 30 }), runtime, channel, store,
      recall: { sendChatMessage: async (_b: string, m: string) => { chats.push(m); } },
    });
    assert.equal(await page.eval(`window.stageVoice.level()`), 0, "silent before Builder speaks");
    const restScale = await page.eval<number>(MOUTH_SCALE);

    const t0 = Date.now();
    const said = speech.say(sessionId, "A sidebar could work here.");
    await page.waitFor(`window.stageVoice.level() > 0.4`, 3000);
    const startedMs = Date.now() - t0;
    console.log(`voice audible on the stage ${startedMs} ms after say`);
    assert.ok(startedMs < 1500, `audio starts quickly: ${startedMs} ms`);
    await page.waitFor(`document.querySelector(".builder").dataset.mood === "speaking"`, 2000);
    await sleep(400);
    const openScale = await page.eval<number>(MOUTH_SCALE);
    assert.ok(openScale > restScale + 0.3, `the mouth opens with the voice: ${restScale} -> ${openScale}`);

    // The 15 fps frame budget holds while the voice plays.
    await page.eval(`window.__ticks.length = 0`);
    await sleep(2000);
    const ticks = await page.eval<number[]>(`window.__ticks.slice()`);
    const gaps = ticks.slice(1).map((v, i) => v - ticks[i]).sort((a, b) => a - b);
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    console.log(`frame budget with voice: ${gaps.length} ticks, p95 ${p95.toFixed(1)}ms`);
    assert.ok(gaps.length >= 25, `only ${gaps.length} ticks in 2s`);
    assert.ok(p95 <= 90, `tick interval p95 ${p95}ms`);
    assert.ok(await page.eval<number>(`window.stageVoice.level()`) > 0.4, "still speaking");

    // Barge-in path: stop silences the stage within a few render quanta.
    const s0 = Date.now();
    speech.stop(sessionId);
    await page.waitFor(`window.stageVoice.level() < 0.01`, 1000);
    const stoppedMs = Date.now() - s0;
    console.log(`voice silent ${stoppedMs} ms after stop`);
    assert.ok(stoppedMs < 300, `stop is immediate: ${stoppedMs} ms`);
    await said;
    await sleep(300);
    assert.ok(await page.eval<number>(`window.stageVoice.level()`) < 0.01, "stays silent: late frames of a stopped line are dropped");
    await page.waitFor(`document.querySelector(".builder").dataset.mood !== "speaking"`, 2000);
    assert.deepEqual(chats, []);

    // A line shorter than the stage's prebuffer still plays: speech_end flushes it.
    await page.eval(`window.__peak = 0; window.__peakTimer = setInterval(() => { window.__peak = Math.max(window.__peak, window.stageVoice.level()); }, 5)`);
    const short = createSpeech({ tts: createFakeTts(tone(0.1)), runtime, channel, store, recall: { sendChatMessage: async () => {} } });
    await short.say(sessionId, "Done.");
    await page.waitFor(`window.__peak > 0.4`, 2000);
    await sleep(300);
    assert.ok(await page.eval<number>(`window.stageVoice.level()`) < 0.01, "and then it is quiet");
    await page.eval(`clearInterval(window.__peakTimer)`);
  });
});
