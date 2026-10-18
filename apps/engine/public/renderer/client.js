// Stage connection: WebSocket first, with automatic fallback to 1 s /state polling.
// While polling, the socket is retried in the background and polling stops once it opens.

const POLL_MS = 1000;
const RETRY_MS = 5000;
const OPEN_TIMEOUT_MS = 4000;
// Binary frames are Builder's voice: [36-byte utterance id, ascii][pcm16le mono] (src/stage/channel.ts).
const ID_BYTES = 36;
const ascii = new TextDecoder("ascii");

/** onEvent(ev) gets every JSON StageEvent; onAudio(utteranceId, pcm: ArrayBuffer) gets each audio frame. */
export function connectStage({ sessionPath, token, onEvent, onAudio = () => {} }) {
  const q = `?token=${encodeURIComponent(token)}`;
  const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${sessionPath}/ws${q}`;
  const stateUrl = `${sessionPath}/state${q}`;
  let ws = null;
  let polling = false;
  let pollTimer = null;
  let retryTimer = null;
  let lastPoll = "";
  let closed = false;

  async function poll() {
    pollTimer = null;
    if (!polling || closed) return;
    try {
      const r = await fetch(stateUrl, { cache: "no-store" });
      if (r.ok) {
        const text = await r.text();
        if (polling && text !== lastPoll) {
          lastPoll = text;
          onEvent({ type: "snapshot", ...JSON.parse(text) });
        }
      }
    } catch {
      // transient network error: try again next tick
    }
    if (polling && !closed) pollTimer = setTimeout(poll, POLL_MS);
  }

  function startPolling() {
    if (polling || closed) return;
    polling = true;
    poll();
  }

  function stopPolling() {
    polling = false;
    lastPoll = "";
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function open() {
    retryTimer = null;
    if (closed) return;
    const sock = new WebSocket(wsUrl);
    sock.binaryType = "arraybuffer";
    ws = sock;
    let opened = false;
    const openTimer = setTimeout(() => { if (!opened) sock.close(); }, OPEN_TIMEOUT_MS);
    sock.onopen = () => {
      opened = true;
      clearTimeout(openTimer);
      stopPolling(); // the server sends a fresh snapshot on every connect
    };
    sock.onmessage = (e) => {
      if (typeof e.data !== "string") {
        if (e.data.byteLength > ID_BYTES) onAudio(ascii.decode(new Uint8Array(e.data, 0, ID_BYTES)), e.data.slice(ID_BYTES));
        return;
      }
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    sock.onclose = () => {
      clearTimeout(openTimer);
      if (ws === sock) ws = null;
      if (closed) return;
      startPolling();
      retryTimer = setTimeout(open, RETRY_MS);
    };
    sock.onerror = () => sock.close();
  }

  open();

  return {
    send(msg) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close() {
      closed = true;
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    },
  };
}

// ---------- Bot-local meeting data: who is talking, so Builder can stop the moment a person starts ----------

// Reachable only from inside a Recall Output Media page. Same message shape as real-time transcription.
export const MEETING_DATA_URL = "wss://meeting-data.bot.recall.ai/api/v1/transcript";
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);
const MD_MIN_RETRY_MS = 2000;
const MD_MAX_RETRY_MS = 60_000;

/**
 * Where to connect for meeting data, or null for nowhere. Tests override with `?meetingData=ws://127.0.0.1:<port>`;
 * the override is honoured only for a loopback host, so a public stage URL cannot aim the page at another socket.
 * A stage served from loopback (tests, local runs) is not in the bot, so it connects only to an override.
 */
export function meetingDataUrl(loc = location) {
  const override = new URLSearchParams(loc.search).get("meetingData");
  if (override !== null) {
    try {
      const u = new URL(override);
      return (u.protocol === "ws:" || u.protocol === "wss:") && LOOPBACK.has(u.hostname) ? u.href : null;
    } catch {
      return null;
    }
  }
  return LOOPBACK.has(loc.hostname) ? null : MEETING_DATA_URL;
}

const nameOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" && typeof v.name === "string" ? v.name : null);

/** True when a meeting-data message carries words spoken by anyone other than the bot. Parses defensively. */
export function isHumanSpeech(msg, botName = "Builder") {
  const root = msg && typeof msg === "object" ? msg : null;
  const t = root?.transcript ?? root?.data?.transcript ?? root?.data ?? root;
  if (!t || typeof t !== "object") return false;
  const words = Array.isArray(t.words) ? t.words : [];
  if (!words.some((w) => (typeof w === "string" ? w : w?.text)?.toString().trim())) return false;
  const who = nameOf(t.speaker) ?? nameOf(t.participant) ?? nameOf(t.speaker_name);
  return who?.trim() !== botName;
}

/**
 * Calls onHumanSpeech() for each meeting-data message with words from someone other than the bot.
 * Where the socket is unavailable (outside the bot) it fails quietly and retries ever more slowly.
 */
export function connectMeetingData({ url = meetingDataUrl(), onHumanSpeech, botName = "Builder" }) {
  if (!url) return { close() {} };
  let sock = null;
  let timer = null;
  let delay = MD_MIN_RETRY_MS;
  let closed = false;

  function open() {
    timer = null;
    if (closed) return;
    let s;
    try {
      s = new WebSocket(url);
    } catch {
      return void schedule();
    }
    sock = s;
    s.onopen = () => { delay = MD_MIN_RETRY_MS; };
    s.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (isHumanSpeech(msg, botName)) onHumanSpeech();
    };
    s.onclose = () => { if (sock === s) sock = null; schedule(); };
    s.onerror = () => s.close();
  }

  function schedule() {
    if (closed || timer) return;
    timer = setTimeout(open, delay);
    delay = Math.min(delay * 2, MD_MAX_RETRY_MS);
  }

  open();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (sock) sock.close();
    },
  };
}
