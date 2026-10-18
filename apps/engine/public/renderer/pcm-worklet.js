// AudioWorklet that plays Builder's voice: pcm16le mono chunks posted from audio.js, at the
// AudioContext's rate (audio.js creates it at the PCM rate, so there's no resampling here).
// Messages: an ArrayBuffer of samples to queue; "end" (the line is complete: play out the tail even
// if it is shorter than the prebuffer); "clear" (drop everything now: the stop path).
// Loaded by URL with audioWorklet.addModule, so it imports nothing.

const PREBUFFER_MS = 120; // held back before playing, so network jitter doesn't break up the voice

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.prebuffer = Math.round((sampleRate * PREBUFFER_MS) / 1000);
    this.reset();
    this.port.onmessage = (e) => this.receive(e.data);
  }

  reset() {
    this.queue = [];
    this.offset = 0; // read position in queue[0]
    this.buffered = 0; // samples queued and not yet played
    this.playing = false;
    this.ended = false;
  }

  receive(m) {
    if (m === "clear") return this.reset();
    if (m === "end") {
      this.ended = this.buffered > 0;
      return;
    }
    if (!(m instanceof ArrayBuffer)) return;
    const s = new Int16Array(m);
    const f = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) f[i] = s[i] / 32768;
    this.queue.push(f);
    this.buffered += f.length;
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.buffered > 0 && (this.buffered >= this.prebuffer || this.ended)) this.playing = true;
    if (!this.playing) return true; // the output is already silence
    let i = 0;
    while (i < out.length && this.queue.length) {
      const head = this.queue[0];
      const n = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      this.buffered -= n;
      if (this.offset === head.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (!this.queue.length) {
      // Drained: the line is over, or the network fell behind and the next chunk rebuffers.
      this.playing = false;
      this.ended = false;
    }
    return true;
  }
}

registerProcessor("pcm-player", PcmPlayer);
