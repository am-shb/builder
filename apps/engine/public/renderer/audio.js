// Builder's voice on the stage: plays the PCM the server streams over the stage WebSocket through
// an AudioWorklet (pcm-worklet.js), and reports how loud it is right now so the mouth can follow.
// Output Media carries the page's audio into the call. The AudioContext starts on the first chunk.

// pcm16le mono at this rate: PCM_SAMPLE_RATE in src/voice/tts.ts. Change both together.
export const PCM_RATE = 24_000;
const WORKLET_URL = "/renderer/pcm-worklet.js";
const ANALYSER_SIZE = 512; // ~21 ms of audio per level reading
const LEVEL_GAIN = 4; // speech RMS sits around 0.05-0.25; this maps it onto the mouth's 0..1

/**
 * Returns the stage's voice:
 * - push(pcm): queue an ArrayBuffer (or typed array) of pcm16le samples; playback starts after a short prebuffer;
 * - end(): the line is complete, so play out whatever is left;
 * - stop(): silence now and drop everything queued;
 * - level(): RMS of what is playing, 0..1, for setMouth.
 */
export function createAudioPlayer({ sampleRate = PCM_RATE, workletUrl = WORKLET_URL } = {}) {
  let ctx = null;
  let node = null;
  let analyser = null;
  let pending = []; // messages posted before the worklet has loaded
  const samples = new Float32Array(ANALYSER_SIZE);

  function init() {
    if (ctx) return;
    ctx = new AudioContext({ sampleRate });
    ctx.audioWorklet.addModule(workletUrl).then(() => {
      node = new AudioWorkletNode(ctx, "pcm-player", { numberOfInputs: 0, outputChannelCount: [1] });
      analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSER_SIZE;
      node.connect(analyser);
      analyser.connect(ctx.destination);
      for (const m of pending) post(m);
      pending = [];
    }).catch((err) => console.error("voice: audio worklet failed to load", err));
  }

  function post(m) {
    if (!node) return void pending.push(m);
    if (m instanceof ArrayBuffer) node.port.postMessage(m, [m]);
    else node.port.postMessage(m);
  }

  return {
    push(pcm) {
      init();
      if (ctx.state !== "running") ctx.resume().catch(() => {});
      const view = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const bytes = view.byteLength & ~1; // whole samples only
      if (bytes) post(view.slice(0, bytes).buffer);
    },
    end() {
      if (ctx) post("end");
    },
    stop() {
      pending = [];
      if (node) node.port.postMessage("clear");
    },
    level() {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
    },
  };
}
