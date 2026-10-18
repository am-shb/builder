// Durable state: scheduling intents (written BEFORE calling Recall), returned bot IDs, lifecycle status,
// verified realtime events, the consensus and model calls. Postgres (docs/adr/0007-database.md), through
// src/db/connect.ts. Every method is async. Guarantees that the old synchronous store got for free are kept
// by the database: a redelivered Recall event is dropped by its unique id (ON CONFLICT DO NOTHING), and a
// missing token is issued with a conditional UPDATE, never by reading and then writing.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { ConsensusDocSchema } from "./consensus/doc.ts";
import type { ConsensusDoc } from "./consensus/doc.ts";
import { Prototype as PrototypeSchema } from "./ui/schema.ts";
import type { Prototype } from "./ui/schema.ts";
import { connect } from "./db/connect.ts";
import type { DbTarget } from "./db/connect.ts";
import { consensus, events, modelCalls, sessions } from "./db/schema.ts";

export type Session = {
  id: string;
  meeting_url: string;
  state: "intent" | "created" | "create_failed";
  bot_id: string | null;
  bot_status: string | null;
  bot_sub_code: string | null;
  error: string | null;
  stage_token: string | null;
  // Read-only capability for the handoff page; never the stage token, which also opens the stage socket.
  handoff_token: string | null;
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

export type ModelCall = {
  id: number;
  session_id: string;
  loop: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  usd: number;
  ms: number;
  created_at: string;
};

const TERMINAL = new Set(["done", "fatal", "call_ended"]);
export const isTerminal = (status: string | null) => !!status && TERMINAL.has(status);

type Log = (msg: string, fields?: Record<string, unknown>) => void;

// Timestamps are timestamptz in the database and ISO strings everywhere else, as before.
const iso = (d: Date) => d.toISOString();
const toSession = (r: typeof sessions.$inferSelect): Session =>
  ({ ...r, state: r.state as Session["state"], created_at: iso(r.created_at), updated_at: iso(r.updated_at) });
const eventCols = {
  id: events.id, session_id: events.session_id, kind: events.kind, speaker: events.speaker, text: events.text, created_at: events.created_at,
};
const toEvent = (r: { created_at: Date } & Omit<StoredEvent, "created_at">): StoredEvent => ({ ...r, created_at: iso(r.created_at) });

/**
 * Opens the store. `databaseUrl` set: Postgres, already migrated by `npm run migrate`. Otherwise PGlite, in
 * `dataDir` or in memory when that is absent too (tests, smoke).
 */
export async function openStore(opts: DbTarget & { log?: Log } = {}) {
  const log: Log = opts.log ?? (() => {});
  const { db, close } = await connect(opts, log);
  const now = () => new Date();
  const newToken = () => randomBytes(24).toString("base64url");

  async function getSession(id: string): Promise<Session | undefined> {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    return row && toSession(row);
  }

  // Issues the token only while the column is empty, so two callers racing get the same one.
  async function ensureToken(id: string, column: "stage_token" | "handoff_token"): Promise<string> {
    const [issued] = await db.update(sessions).set({ [column]: newToken(), updated_at: now() })
      .where(and(eq(sessions.id, id), isNull(sessions[column]))).returning({ token: sessions[column] });
    if (issued?.token) return issued.token;
    const s = await getSession(id);
    if (!s?.[column]) throw new Error("session not found");
    return s[column];
  }

  return {
    async createIntent(id: string, meetingUrl: string): Promise<Session> {
      const t = now();
      const [row] = await db.insert(sessions).values({
        id, meeting_url: meetingUrl, state: "intent", stage_token: newToken(), handoff_token: newToken(), created_at: t, updated_at: t,
      }).returning();
      return toSession(row);
    },
    // An unfinished session for the same meeting means a bot is (or may be) already there.
    async findActiveForMeeting(meetingUrl: string): Promise<Session | undefined> {
      const rows = await db.select().from(sessions)
        .where(and(eq(sessions.meeting_url, meetingUrl), ne(sessions.state, "create_failed")))
        .orderBy(desc(sessions.created_at));
      return rows.map(toSession).find((s) => !isTerminal(s.bot_status));
    },
    async markCreated(id: string, botId: string): Promise<void> {
      await db.update(sessions).set({ state: "created", bot_id: botId, bot_status: "ready", updated_at: now() }).where(eq(sessions.id, id));
    },
    async markCreateFailed(id: string, error: string): Promise<void> {
      await db.update(sessions).set({ state: "create_failed", error, updated_at: now() }).where(eq(sessions.id, id));
    },
    async updateBotStatus(id: string, status: string, subCode: string | null): Promise<void> {
      await db.update(sessions).set({ bot_status: status, bot_sub_code: subCode, updated_at: now() }).where(eq(sessions.id, id));
    },
    // Sessions created without a stage token get one on first use.
    ensureStageToken: (id: string): Promise<string> => ensureToken(id, "stage_token"),
    // Sessions created without a handoff token get one on first use.
    ensureHandoffToken: (id: string): Promise<string> => ensureToken(id, "handoff_token"),
    async setStageHtml(id: string, html: string): Promise<void> {
      await db.update(sessions).set({ stage_html: html, updated_at: now() }).where(eq(sessions.id, id));
    },
    getSession,
    async getSessionByBotId(botId: string): Promise<Session | undefined> {
      const [row] = await db.select().from(sessions).where(eq(sessions.bot_id, botId));
      return row && toSession(row);
    },
    async listSessions(): Promise<Session[]> {
      return (await db.select().from(sessions).orderBy(desc(sessions.created_at)).limit(50)).map(toSession);
    },
    async listActiveSessions(): Promise<Session[]> {
      return (await db.select().from(sessions).where(eq(sessions.state, "created")))
        .map(toSession).filter((s) => !isTerminal(s.bot_status));
    },
    // Returns the stored row, or null when this Recall message was already processed. One statement, so two
    // deliveries of the same message racing each other still store it once.
    async addEvent(e: { sessionId: string; recallMsgId: string | null; kind: string; speaker: string | null; text: string | null }): Promise<StoredEvent | null> {
      const [row] = await db.insert(events)
        .values({ session_id: e.sessionId, recall_msg_id: e.recallMsgId, kind: e.kind, speaker: e.speaker, text: e.text, created_at: now() })
        .onConflictDoNothing({ target: events.recall_msg_id })
        .returning(eventCols);
      return row ? toEvent(row) : null;
    },
    async recentUtterances(sessionId: string, limit: number): Promise<{ speaker: string | null; text: string | null }[]> {
      const rows = await db.select({ speaker: events.speaker, text: events.text }).from(events)
        .where(and(eq(events.session_id, sessionId), eq(events.kind, "utterance"))).orderBy(desc(events.id)).limit(limit);
      return rows.reverse();
    },
    async listEvents(sessionId: string): Promise<StoredEvent[]> {
      return (await db.select(eventCols).from(events).where(eq(events.session_id, sessionId)).orderBy(asc(events.id))).map(toEvent);
    },
    // A row that no longer parses (written by older code, say) reads as absent, so the session starts
    // from a fresh doc instead of throwing on every later event.
    async getConsensus(sessionId: string): Promise<{ doc: ConsensusDoc; proto: Prototype } | undefined> {
      const [row] = await db.select({ doc_json: consensus.doc_json, proto_json: consensus.proto_json }).from(consensus)
        .where(eq(consensus.session_id, sessionId));
      if (!row) return undefined;
      const json = (text: string | null): unknown => { try { return JSON.parse(text ?? ""); } catch { return undefined; } };
      const doc = ConsensusDocSchema.safeParse(json(row.doc_json));
      const proto = PrototypeSchema.safeParse(json(row.proto_json));
      if (!doc.success || !proto.success) {
        log("store.consensus_invalid", { session_id: sessionId, doc_ok: doc.success, proto_ok: proto.success });
        return undefined;
      }
      return { doc: doc.data, proto: proto.data };
    },
    async saveConsensus(sessionId: string, doc: ConsensusDoc, proto: Prototype): Promise<void> {
      const row = { doc_json: JSON.stringify(doc), proto_json: JSON.stringify(proto), updated_at: now() };
      await db.insert(consensus).values({ session_id: sessionId, ...row })
        .onConflictDoUpdate({ target: consensus.session_id, set: row });
    },
    async addModelCall(c: { sessionId: string; loop: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; usd: number; ms: number }): Promise<void> {
      await db.insert(modelCalls).values({
        session_id: c.sessionId, loop: c.loop, model: c.model, input_tokens: c.inputTokens, output_tokens: c.outputTokens,
        cache_read_tokens: c.cacheReadTokens, cache_write_tokens: c.cacheWriteTokens, usd: c.usd, ms: Math.round(c.ms), created_at: now(),
      });
    },
    async listModelCalls(sessionId: string): Promise<ModelCall[]> {
      const rows = await db.select().from(modelCalls).where(eq(modelCalls.session_id, sessionId)).orderBy(asc(modelCalls.id));
      return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
    },
    async sessionCost(sessionId: string): Promise<number> {
      const [row] = await db.select({ total: sql<number>`COALESCE(SUM(${modelCalls.usd}), 0)`.mapWith(Number) }).from(modelCalls)
        .where(eq(modelCalls.session_id, sessionId));
      return row.total;
    },
    close(): Promise<void> {
      return close();
    },
  };
}

export type Store = Awaited<ReturnType<typeof openStore>>;
