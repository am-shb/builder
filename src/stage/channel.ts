// Stage WebSocket channel: pushes StageEvents (JSON) and audio (binary) to the
// page the bot screenshares. Auth happens at the HTTP upgrade; a bad token
// never completes the handshake.
import type http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { Prototype, Change, Interaction } from "../ui/schema.ts";
import type { ConsensusDoc } from "../consensus/doc.ts";
import type { Mood } from "../session/mood.ts";

export type Caption = { speaker: string; text: string; partial: boolean; isAgent: boolean };

export type ComparisonView = {
  conflictId: string;
  topic: string;
  variants: { label: string; summary: string; backers: string[]; proto: Prototype; focusIds: string[] }[];
};

export type StageEvent =
  | { type: "snapshot"; proto: Prototype; uiScreen: string; doc: ConsensusDoc; captions: Caption[]; mood: Mood; comparison: ComparisonView | null }
  | { type: "patch"; proto: Prototype; changes: Change[] }
  | { type: "doc"; doc: ConsensusDoc }
  | { type: "mood"; mood: Mood }
  | { type: "caption"; caption: Caption }
  | { type: "pending_region"; parentId: string | null }
  | { type: "command"; nodeId: string; interaction: Interaction }
  | { type: "comparison"; view: ComparisonView | null }
  | { type: "resolve"; conflictId: string; winner: string }
  | { type: "speech_start"; utteranceId: string; text: string }
  | { type: "speech_end"; utteranceId: string }
  | { type: "speech_stop" };

export type StageSink = {
  send(sessionId: string, ev: StageEvent): void;
  sendAudio(sessionId: string, utteranceId: string, pcm: Uint8Array): void;
  clients(sessionId: string): number;
};

export const PING_MS = 25_000;
const WS_PATH = /^\/stage\/([0-9a-f-]{36})\/ws$/;
const MAX_CLIENT_MESSAGE = 64 * 1024;

export function createStageChannel(
  server: http.Server,
  auth: (sessionId: string, token: string) => boolean,
  onClientMessage: (sessionId: string, msg: unknown) => void,
  snapshotFor: (sessionId: string) => StageEvent,
  log: (msg: string, fields?: Record<string, unknown>) => void = () => {},
): StageSink {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE });
  const bySession = new Map<string, Set<WebSocket>>();

  function reject(socket: Duplex) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  }

  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://local");
    const m = url.pathname.match(WS_PATH);
    if (!m) return void socket.destroy();
    const sessionId = m[1];
    if (!auth(sessionId, url.searchParams.get("token") ?? "")) return reject(socket);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const set = bySession.get(sessionId) ?? new Set();
      set.add(ws);
      bySession.set(sessionId, set);
      ws.on("close", () => {
        set.delete(ws);
        if (!set.size && bySession.get(sessionId) === set) bySession.delete(sessionId);
      });
      ws.on("error", () => ws.terminate());
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        try {
          onClientMessage(sessionId, JSON.parse(data.toString("utf8")));
        } catch {
          // malformed client message: ignore
        }
      });
      try {
        ws.send(JSON.stringify(snapshotFor(sessionId)));
      } catch {
        log("channel.snapshot_failed", { session_id: sessionId });
        ws.terminate();
      }
    });
  });

  const pinger = setInterval(() => {
    for (const set of bySession.values()) for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, PING_MS);
  pinger.unref();
  server.on("close", () => {
    clearInterval(pinger);
    for (const set of bySession.values()) for (const ws of set) ws.terminate();
  });

  const broadcast = (sessionId: string, data: string | Uint8Array) => {
    for (const ws of bySession.get(sessionId) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  return {
    send: (sessionId, ev) => broadcast(sessionId, JSON.stringify(ev)),
    // Frame: [36-byte utteranceId, ascii][pcm16le mono at PCM_SAMPLE_RATE (src/voice/tts.ts), whole samples].
    sendAudio(sessionId, utteranceId, pcm) {
      if (!/^[\x20-\x7e]{36}$/.test(utteranceId)) throw new Error("utteranceId must be 36 ascii characters");
      broadcast(sessionId, Buffer.concat([Buffer.from(utteranceId, "ascii"), pcm]));
    },
    clients: (sessionId) => bySession.get(sessionId)?.size ?? 0,
  };
}

export const noopStageSink: StageSink = { send() {}, sendAudio() {}, clients: () => 0 };
