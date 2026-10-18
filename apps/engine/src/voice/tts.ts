// Text-to-speech behind one small interface, so the provider can be swapped (spec §13):
// OpenRouter's Eleven v4 Turbo today, direct ElevenLabs or Cartesia later.

/**
 * The PCM format every provider yields and the stage plays: 16-bit little-endian, mono, at this
 * rate. OpenRouter doesn't document the rate for ElevenLabs PCM (test/fixtures/openrouter-tts.md);
 * 24 kHz is the assumed default until confirmed live (scripts/probe-tts.ts). The stage's copy is
 * PCM_RATE in public/renderer/audio.js; change both together.
 */
export const PCM_SAMPLE_RATE = 24_000;
export const PCM_BYTES_PER_MS = (PCM_SAMPLE_RATE * 2) / 1000;

export interface TtsProvider {
  /** Speaks the whole line; yields pcm16le mono at PCM_SAMPLE_RATE as it's generated. Aborting `signal` ends the request. */
  stream(text: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}

/** Test provider: yields `chunks` in order, `delayMs` apart, and stops when the signal aborts. */
export function createFakeTts(chunks: Uint8Array[], opts: { delayMs?: number } = {}): TtsProvider {
  const delayMs = opts.delayMs ?? 0;
  return {
    async *stream(_text, signal) {
      for (const c of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        signal.throwIfAborted();
        yield c;
      }
    },
  };
}
