// Builder's voice (spec §13): each line goes to the TTS provider whole, and its PCM streams to the
// stage over the stage WebSocket as it's generated (speech_start, binary frames, speech_end); the
// stage plays it, and Output Media carries the page's audio into the call. stop() cuts it at once.
// When the provider fails or stalls past timeoutMs, the line goes to meeting chat instead.
// Logs ids, byte counts and durations only: never the line or the audio.
import { randomUUID } from "node:crypto";
import { PCM_BYTES_PER_MS } from "./tts.ts";
import type { TtsProvider } from "./tts.ts";
import type { Speech } from "../agent/conversation-loop.ts";
import type { Log, SessionRuntime } from "../session/runtime.ts";
import type { StageSink } from "../stage/channel.ts";
import type { RecallClient } from "../recall-client.ts";
import type { Store } from "../store.ts";

export const TTS_TIMEOUT_MS = 4000;
// The provider sends a line's audio only once it has generated it, so a longer line's first chunk
// comes later: that wait grows with the text, up to twice the gap allowed between chunks (known issue M5).
export const FIRST_CHUNK_MS_PER_CHAR = 15;

/** How long to wait for a line's first audio: 4 s plus 15 ms a character, at most 8 s (with the default timeout). */
export function firstChunkTimeout(text: string, timeoutMs = TTS_TIMEOUT_MS): number {
  return Math.min(2 * timeoutMs, timeoutMs + text.length * FIRST_CHUNK_MS_PER_CHAR);
}
const CHAT_MAX = 500; // Google Meet's chat limit
// The stage holds back a short buffer before it plays (PREBUFFER_MS in pcm-worklet.js), and frames
// take a moment to arrive: Builder counts as speaking this much past the audio's own length.
const PLAYBACK_SLACK_MS = 250;

type Active = { utteranceId: string; controller: AbortController; stopped: boolean; endTimer?: ReturnType<typeof setTimeout> };

const errorName = (err: unknown) => (err instanceof Error || err instanceof DOMException ? err.name : "unknown");

/** Keeps frames on whole 16-bit samples: an odd trailing byte waits for the next chunk. */
function sampleAligner() {
  let carry: Uint8Array | null = null;
  return (chunk: Uint8Array): Uint8Array => {
    let data = chunk;
    if (carry) {
      data = new Uint8Array(carry.length + chunk.length);
      data.set(carry);
      data.set(chunk, carry.length);
      carry = null;
    }
    if (data.length % 2) {
      carry = data.slice(-1);
      data = data.subarray(0, -1);
    }
    return data;
  };
}

export function createSpeech(deps: {
  tts: TtsProvider;
  runtime: (sessionId: string) => SessionRuntime;
  recall: Pick<RecallClient, "sendChatMessage">;
  store: Pick<Store, "getSession" | "addEvent">;
  channel: StageSink;
  timeoutMs?: number;
  botName?: string;
  log?: Log;
}): Speech {
  const { tts, runtime, recall, store, channel } = deps;
  const timeoutMs = deps.timeoutMs ?? TTS_TIMEOUT_MS;
  const botName = deps.botName ?? "Builder";
  const log: Log = deps.log ?? (() => {});
  const now = () => performance.now();
  // Per session, the line being streamed or still playing on the stage.
  const active = new Map<string, Active>();

  function finish(sessionId: string, a: Active) {
    clearTimeout(a.endTimer);
    if (active.get(sessionId) !== a) return;
    active.delete(sessionId);
    runtime(sessionId).updateMoodInputs({ speaking: false });
  }

  function stop(sessionId: string) {
    const a = active.get(sessionId);
    if (!a) return;
    a.stopped = true;
    a.controller.abort();
    channel.send(sessionId, { type: "speech_stop" });
    finish(sessionId, a);
    log("speech.stopped", { session_id: sessionId, utterance_id: a.utteranceId });
  }

  async function toChat(sessionId: string, text: string) {
    const botId = (await store.getSession(sessionId))?.bot_id;
    if (!botId) throw new Error("no bot for session");
    const line = text.slice(0, CHAT_MAX);
    await recall.sendChatMessage(botId, line);
    await store.addEvent({ sessionId, recallMsgId: null, kind: "bot_chat", speaker: botName, text: line });
  }

  async function say(sessionId: string, text: string): Promise<string> {
    stop(sessionId); // one voice at a time
    const utteranceId = randomUUID();
    const controller = new AbortController();
    const a: Active = { utteranceId, controller, stopped: false };
    active.set(sessionId, a);
    const rt = runtime(sessionId);
    // Only says that Builder is talking: the line itself never goes to the stage (spec §10a, known issue I7).
    rt.caption({ partial: false, isAgent: true });

    // The stream must keep coming: firstChunkTimeout to the first chunk, then timeoutMs between chunks.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException("TTS timed out", "TimeoutError"));
      }, ms);
    };
    // Races every read, so a stop or timeout ends the line even if the provider ignores the signal.
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    aborted.catch(() => {});

    const t0 = now();
    const align = sampleAligner();
    let bytes = 0;
    let playsUntil = 0; // when the stage will have played everything sent so far
    let it: AsyncIterator<Uint8Array> | undefined;
    try {
      arm(firstChunkTimeout(text, timeoutMs));
      it = tts.stream(text, controller.signal)[Symbol.asyncIterator]();
      for (;;) {
        const r = await Promise.race([it.next(), aborted]);
        if (r.done) break;
        arm(timeoutMs);
        const pcm = align(r.value);
        if (!pcm.length) continue;
        if (!bytes) {
          channel.send(sessionId, { type: "speech_start", utteranceId });
          rt.updateMoodInputs({ speaking: true });
          log("speech.started", { session_id: sessionId, utterance_id: utteranceId, first_audio_ms: Math.round(now() - t0) });
        }
        channel.sendAudio(sessionId, utteranceId, pcm);
        bytes += pcm.length;
        playsUntil = Math.max(playsUntil, now() + PLAYBACK_SLACK_MS) + pcm.length / PCM_BYTES_PER_MS;
      }
      if (!bytes) throw new Error("no audio");
    } catch (err) {
      it?.return?.()?.catch(() => {});
      if (a.stopped) return utteranceId; // interrupted: stop() has told the stage
      if (bytes) channel.send(sessionId, { type: "speech_stop" });
      finish(sessionId, a);
      log("speech.fallback", {
        session_id: sessionId, utterance_id: utteranceId, reason: timedOut ? "timeout" : "error", error: errorName(err),
        ...(typeof (err as { status?: unknown }).status === "number" ? { status: (err as { status: number }).status } : {}),
        bytes, ms: Math.round(now() - t0),
      });
      await toChat(sessionId, text);
      return utteranceId;
    } finally {
      clearTimeout(timer);
    }
    if (a.stopped) return utteranceId;
    channel.send(sessionId, { type: "speech_end", utteranceId });
    log("speech.done", {
      session_id: sessionId, utterance_id: utteranceId, bytes,
      audio_ms: Math.round(bytes / PCM_BYTES_PER_MS), ms: Math.round(now() - t0),
    });
    // Still speaking until the stage has played it all.
    a.endTimer = setTimeout(() => finish(sessionId, a), Math.max(0, playsUntil - now()));
    a.endTimer.unref?.();
    return utteranceId;
  }

  return { say, stop, speaking: (sessionId) => active.has(sessionId) };
}
