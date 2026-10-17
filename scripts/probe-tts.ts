// Manual live probe (a fraction of a cent). Needs OPENROUTER_API_KEY in the env or .env; TTS_VOICE
// is optional (default "george").
//   node scripts/probe-tts.ts
// Sends one fixed line to elevenlabs/eleven-v4-turbo with response_format "pcm" and confirms the
// PCM format the stage assumes (PCM_SAMPLE_RATE, 16-bit mono): prints the response headers, the time
// to the first chunk, the byte count and the duration each candidate sample rate would imply, and
// saves the audio so you can listen at the assumed rate. Words at a normal pace run about 2.5 per
// second, so the right rate gives a duration near the expected one, and plays at a natural pitch.
import { existsSync, writeFileSync } from "node:fs";
import { createOpenRouterTts, OPENROUTER_TTS_MODEL } from "../src/voice/openrouter-tts.ts";
import { PCM_SAMPLE_RATE } from "../src/voice/tts.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const voice = process.env.TTS_VOICE?.trim() || "george";
const LINE = "Hi, I'm Builder. I'll mostly listen and sketch what you agree on.";
const OUT = "probe-tts.pcm";

let headers: Headers | null = null;
const tracingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  headers = res.headers;
  return res;
};

const tts = createOpenRouterTts({ apiKey, voice, model: OPENROUTER_TTS_MODEL, fetch: tracingFetch });
const t0 = performance.now();
let firstMs = 0;
const chunks: Uint8Array[] = [];
for await (const c of tts.stream(LINE, AbortSignal.timeout(30_000))) {
  if (!chunks.length) firstMs = performance.now() - t0;
  chunks.push(c);
}
const totalMs = performance.now() - t0;
const pcm = Buffer.concat(chunks);
writeFileSync(OUT, pcm);

const h = headers as Headers | null;
console.log(`content-type: ${h?.get("content-type")}  x-generation-id: ${h?.get("x-generation-id")}`);
console.log(`first chunk ${firstMs.toFixed(0)} ms, done ${totalMs.toFixed(0)} ms, ${chunks.length} chunks, ${pcm.length} bytes (${pcm.length % 2 ? "odd: not 16-bit?" : "even"})`);
const words = LINE.split(/\s+/).length;
console.log(`expected speech duration ~${(words / 2.5).toFixed(1)} s for ${words} words`);
for (const rate of [16_000, 22_050, 24_000, 44_100, 48_000]) {
  console.log(`  at ${rate} Hz 16-bit mono: ${(pcm.length / 2 / rate).toFixed(2)} s${rate === PCM_SAMPLE_RATE ? "  <- assumed (PCM_SAMPLE_RATE)" : ""}`);
}
console.log(`saved ${OUT}; listen: ffplay -f s16le -ar ${PCM_SAMPLE_RATE} -ac 1 ${OUT}  (or: sox -t raw -r ${PCM_SAMPLE_RATE} -e signed -b 16 -c 1 ${OUT} -d)`);
