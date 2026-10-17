// Durable local state: scheduling intents (written BEFORE calling Recall),
// returned bot IDs, lifecycle status, and verified realtime events.
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Session = {
  id: string;
  meeting_url: string;
  state: "intent" | "created" | "create_failed";
  bot_id: string | null;
  bot_status: string | null;
  bot_sub_code: string | null;
  error: string | null;
  stage_token: string | null;
  stage_html: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredEvent = {
  id: number;
  session_id: string;
  kind: string;
  speaker: string | null;
  text: string | null;
  created_at: string;
};

const TERMINAL = new Set(["done", "fatal", "call_ended"]);
export const isTerminal = (status: string | null) => !!status && TERMINAL.has(status);

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      meeting_url TEXT NOT NULL,
      state TEXT NOT NULL,
      bot_id TEXT UNIQUE,
      bot_status TEXT,
      bot_sub_code TEXT,
      error TEXT,
      stage_token TEXT,
      stage_html TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      recall_msg_id TEXT UNIQUE,
      kind TEXT NOT NULL,
      speaker TEXT,
      text TEXT,
      created_at TEXT NOT NULL
    );
  `);
  // Additive migration for databases created before the stage columns existed.
  const cols = new Set((db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map((c) => c.name));
  for (const col of ["stage_token", "stage_html"]) {
    if (!cols.has(col)) db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
  }
  const now = () => new Date().toISOString();
  const newToken = () => randomBytes(24).toString("base64url");

  return {
    createIntent(id: string, meetingUrl: string): Session {
      const t = now();
      db.prepare(`INSERT INTO sessions (id, meeting_url, state, stage_token, created_at, updated_at) VALUES (?, ?, 'intent', ?, ?, ?)`)
        .run(id, meetingUrl, newToken(), t, t);
      return this.getSession(id)!;
    },
    // An unfinished session for the same meeting means a bot is (or may be) already there.
    findActiveForMeeting(meetingUrl: string): Session | undefined {
      const rows = db.prepare(`SELECT * FROM sessions WHERE meeting_url = ? AND state != 'create_failed' ORDER BY created_at DESC`)
        .all(meetingUrl) as Session[];
      return rows.find((s) => !isTerminal(s.bot_status));
    },
    markCreated(id: string, botId: string) {
      db.prepare(`UPDATE sessions SET state = 'created', bot_id = ?, bot_status = 'ready', updated_at = ? WHERE id = ?`)
        .run(botId, now(), id);
    },
    markCreateFailed(id: string, error: string) {
      db.prepare(`UPDATE sessions SET state = 'create_failed', error = ?, updated_at = ? WHERE id = ?`)
        .run(error, now(), id);
    },
    updateBotStatus(id: string, status: string, subCode: string | null) {
      db.prepare(`UPDATE sessions SET bot_status = ?, bot_sub_code = ?, updated_at = ? WHERE id = ?`)
        .run(status, subCode, now(), id);
    },
    // Sessions created before stages existed get a token on first use.
    ensureStageToken(id: string): string {
      const s = this.getSession(id)!;
      if (s.stage_token) return s.stage_token;
      const token = newToken();
      db.prepare(`UPDATE sessions SET stage_token = ?, updated_at = ? WHERE id = ?`).run(token, now(), id);
      return token;
    },
    setStageHtml(id: string, html: string) {
      db.prepare(`UPDATE sessions SET stage_html = ?, updated_at = ? WHERE id = ?`).run(html, now(), id);
    },
    getSession(id: string): Session | undefined {
      return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session | undefined;
    },
    getSessionByBotId(botId: string): Session | undefined {
      return db.prepare(`SELECT * FROM sessions WHERE bot_id = ?`).get(botId) as Session | undefined;
    },
    listSessions(): Session[] {
      return db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50`).all() as Session[];
    },
    listActiveSessions(): Session[] {
      return (db.prepare(`SELECT * FROM sessions WHERE state = 'created'`).all() as Session[])
        .filter((s) => !isTerminal(s.bot_status));
    },
    // Returns the stored row, or null when this Recall message was already processed.
    addEvent(e: { sessionId: string; recallMsgId: string | null; kind: string; speaker: string | null; text: string | null }): StoredEvent | null {
      const res = db.prepare(`INSERT OR IGNORE INTO events (session_id, recall_msg_id, kind, speaker, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(e.sessionId, e.recallMsgId, e.kind, e.speaker, e.text, now());
      if (res.changes === 0) return null;
      return db.prepare(`SELECT id, session_id, kind, speaker, text, created_at FROM events WHERE id = ?`)
        .get(res.lastInsertRowid) as StoredEvent;
    },
    recentUtterances(sessionId: string, limit: number): { speaker: string | null; text: string | null }[] {
      const rows = db.prepare(`SELECT speaker, text FROM events WHERE session_id = ? AND kind = 'utterance' ORDER BY id DESC LIMIT ?`)
        .all(sessionId, limit) as { speaker: string | null; text: string | null }[];
      return rows.reverse();
    },
    listEvents(sessionId: string): StoredEvent[] {
      return db.prepare(`SELECT id, session_id, kind, speaker, text, created_at FROM events WHERE session_id = ? ORDER BY id`)
        .all(sessionId) as StoredEvent[];
    },
    close() {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;
