// Stage connection: WebSocket first, with automatic fallback to 1 s /state polling.
// While polling, the socket is retried in the background and polling stops once it opens.

const POLL_MS = 1000;
const RETRY_MS = 5000;
const OPEN_TIMEOUT_MS = 4000;

export function connectStage({ sessionPath, token, onEvent }) {
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
      if (typeof e.data !== "string") return void onEvent({ type: "audio", data: e.data });
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
