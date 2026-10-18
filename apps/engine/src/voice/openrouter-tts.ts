// Eleven v4 Turbo through OpenRouter's speech endpoint (protocol: test/fixtures/openrouter-tts.md).
// One POST per line with response_format "pcm"; the response body is raw PCM, streamed as it's
// generated. The key stays here, in the backend. Errors carry the status only, never a body.
import type { TtsProvider } from "./tts.ts";

export const OPENROUTER_TTS_MODEL = "elevenlabs/eleven-v4-turbo";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export class TtsError extends Error {
  status: number;
  constructor(status: number) {
    super(`TTS request failed with ${status}`);
    this.name = "TtsError";
    this.status = status;
  }
}

export function createOpenRouterTts(opts: {
  apiKey: string;
  voice: string;
  model: typeof OPENROUTER_TTS_MODEL;
  baseUrl?: string;
  fetch?: typeof fetch;
}): TtsProvider {
  const doFetch = opts.fetch ?? fetch;
  const url = `${(opts.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "")}/audio/speech`;
  return {
    async *stream(text, signal) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: opts.model, input: text, voice: opts.voice, response_format: "pcm" }),
        signal,
      });
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {});
        throw new TtsError(res.status);
      }
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value.byteLength) yield value;
        }
      } finally {
        // An early exit (abort, or the consumer stopped) closes the request.
        reader.cancel().catch(() => {});
      }
    },
  };
}
