// Durable state: scheduling intents (written BEFORE calling Recall), returned bot IDs, lifecycle status,
// verified realtime events, the consensus and model calls. SurrealDB (docs/adr/0011-surrealdb.md), through
// src/db/connect.ts, with the schema in db/*.surql (which also says how ids and timestamps map). Every method is
// async. Guarantees that the old synchronous store got for free are kept by the database: a redelivered Recall
// event is dropped by its unique index, and a missing token is issued with a conditional UPDATE,
// never by reading and then writing. Two writes that collide fail with a transaction conflict, and every query
// here is one statement sent again on a conflict (connect.ts), so the second one sees the first one's write.
import { randomBytes } from "node:crypto";
import { RecordId } from "surrealdb";
import type { DateTime, Surreal } from "surrealdb";
import { ConsensusDocSchema } from "./consensus/doc.ts";
import type { ConsensusDoc } from "./consensus/doc.ts";
import { Prototype as PrototypeSchema } from "./ui/schema.ts";
import type { Prototype } from "./ui/schema.ts";
import { connect } from "./db/connect.ts";
import type { DbTarget } from "./db/connect.ts";
import { migrate } from "./db/migrate.ts";

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
  // The org that started it through POST /internal/sessions, and its limits (db/0002). null for sessions the
  // operator starts from the local routes.
  org_id: string | null;
  max_usd: number | null;
  max_minutes: number | null;
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

// Rows as SurrealDB returns them: record ids, datetimes, and absent fields where SQLite had NULL.
type Opt<T> = T | undefined;
type SessionRow = {
  id: RecordId<"sessions", string>; meeting_url: string; state: Session["state"]; bot_id: Opt<string>; bot_status: Opt<string>;
  bot_sub_code: Opt<string>; error: Opt<string>; stage_token: Opt<string>; handoff_token: Opt<string>; stage_html: Opt<string>;
  org_id: Opt<string>; max_usd: Opt<number>; max_minutes: Opt<number>;
  created_at: DateTime; updated_at: DateTime;
};
type EventRow = {
  id: RecordId<"events", number>; session_id: RecordId<"sessions", string>; kind: string; speaker: Opt<string>; text: Opt<string>; created_at: DateTime;
};
type ModelCallRow = Omit<ModelCall, "id" | "created_at"> & { id: RecordId<"model_calls", number>; created_at: DateTime };

const iso = (d: DateTime) => d.toDate().toISOString();
const sessionRef = (id: string) => new RecordId("sessions", id);
// NONE is what the schema stores for "no value"; a JS null would be stored as NULL, which an option<string> refuses.
const none = <T>(v: T | null): T | undefined => v ?? undefined;

const toSession = (r: SessionRow): Session => ({
  id: r.id.id, meeting_url: r.meeting_url, state: r.state, bot_id: r.bot_id ?? null, bot_status: r.bot_status ?? null,
  bot_sub_code: r.bot_sub_code ?? null, error: r.error ?? null, stage_token: r.stage_token ?? null,
  handoff_token: r.handoff_token ?? null, stage_html: r.stage_html ?? null,
  org_id: r.org_id ?? null, max_usd: r.max_usd ?? null, max_minutes: r.max_minutes ?? null,
  created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});
const toEvent = (r: EventRow): StoredEvent => ({
  id: r.id.id, session_id: r.session_id.id, kind: r.kind, speaker: r.speaker ?? null, text: r.text ?? null, created_at: iso(r.created_at),
});

/**
 * Opens the store. `url` set: that SurrealDB server, already migrated by `npm run migrate`. Otherwise SurrealDB in
 * this process, in the SurrealKV folder `path`, or in memory when that is absent too (tests, smoke), migrated here.
 */
export async function openStore(opts: DbTarget & { log?: Log } = {}) {
  const log: Log = opts.log ?? (() => {});
  const db: Surreal = await connect(opts);
  if (!opts.url) {
    try {
      await migrate(db);
    } catch (err) {
      await db.close().catch(() => {});
      throw err;
    }
  }
  const now = () => new Date();
  const newToken = () => randomBytes(24).toString("base64url");
  let closing: Promise<void> | undefined;

  // One statement, sent again when it hits a transaction conflict. Results are per statement.
  const run = <R extends unknown[]>(sql: string, vars?: Record<string, unknown>) => db.query<R>(sql, vars).retry().collect();

  async function getSession(id: string): Promise<Session | undefined> {
    const [[row]] = await run<[SessionRow[]]>("SELECT * FROM $id", { id: sessionRef(id) });
    return row && toSession(row);
  }

  // Issues the token only while the field is empty, so two callers racing get the same one.
  async function ensureToken(id: string, field: "stage_token" | "handoff_token"): Promise<string> {
    const [[issued]] = await run<[string[]]>(`UPDATE $id SET ${field} = $tok, updated_at = $now WHERE ${field} = NONE RETURN VALUE ${field}`,
      { id: sessionRef(id), tok: newToken(), now: now() });
    if (issued) return issued;
    const s = await getSession(id);
    if (!s?.[field]) throw new Error("session not found");
    return s[field];
  }

  return {
    // `org` is set for sessions the api starts (POST /internal/sessions): the org and its limits.
    async createIntent(id: string, meetingUrl: string, org?: { orgId: string; maxUsd: number; maxMinutes: number }): Promise<Session> {
      const t = now();
      const [row] = await run<[SessionRow]>("CREATE ONLY $id CONTENT $row", {
        id: sessionRef(id),
        row: {
          meeting_url: meetingUrl, state: "intent", stage_token: newToken(), handoff_token: newToken(), created_at: t, updated_at: t,
          ...(org ? { org_id: org.orgId, max_usd: org.maxUsd, max_minutes: org.maxMinutes } : {}),
        },
      });
      return toSession(row);
    },
    // An unfinished session for the same meeting means a bot is (or may be) already there. Only within one org
    // (E3): an org never gets another org's session, or its stage URL. `orgId` null looks only at sessions with
    // no org, the ones the operator starts from the local routes.
    async findActiveForMeeting(meetingUrl: string, orgId: string | null = null): Promise<Session | undefined> {
      const [rows] = await run<[SessionRow[]]>(
        `SELECT * FROM sessions WHERE meeting_url = $url AND org_id = $org AND state != "create_failed" ORDER BY created_at DESC`,
        { url: meetingUrl, org: none(orgId) });
      return rows.map(toSession).find((s) => !isTerminal(s.bot_status));
    },
    async markCreated(id: string, botId: string): Promise<void> {
      await run(`UPDATE $id SET state = "created", bot_id = $bot, bot_status = "ready", updated_at = $now RETURN NONE`,
        { id: sessionRef(id), bot: botId, now: now() });
    },
    async markCreateFailed(id: string, error: string): Promise<void> {
      await run(`UPDATE $id SET state = "create_failed", error = $error, updated_at = $now RETURN NONE`, { id: sessionRef(id), error, now: now() });
    },
    async updateBotStatus(id: string, status: string, subCode: string | null): Promise<void> {
      await run("UPDATE $id SET bot_status = $status, bot_sub_code = $sub, updated_at = $now RETURN NONE",
        { id: sessionRef(id), status, sub: none(subCode), now: now() });
    },
    // Sessions created without a stage token get one on first use.
    ensureStageToken: (id: string): Promise<string> => ensureToken(id, "stage_token"),
    // Sessions created without a handoff token get one on first use.
    ensureHandoffToken: (id: string): Promise<string> => ensureToken(id, "handoff_token"),
    async setStageHtml(id: string, html: string): Promise<void> {
      await run("UPDATE $id SET stage_html = $html, updated_at = $now RETURN NONE", { id: sessionRef(id), html, now: now() });
    },
    getSession,
    async getSessionByBotId(botId: string): Promise<Session | undefined> {
      const [[row]] = await run<[SessionRow[]]>("SELECT * FROM sessions WHERE bot_id = $bot LIMIT 1", { bot: botId });
      return row && toSession(row);
    },
    async listSessions(): Promise<Session[]> {
      const [rows] = await run<[SessionRow[]]>("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50");
      return rows.map(toSession);
    },
    async listActiveSessions(): Promise<Session[]> {
      const [rows] = await run<[SessionRow[]]>(`SELECT * FROM sessions WHERE state = "created"`);
      return rows.map(toSession).filter((s) => !isTerminal(s.bot_status));
    },
    // Returns the stored row, or null when this Recall message was already processed. One statement: it looks for
    // the message id and stores the event only when it isn't there. Two deliveries racing each other both write
    // the unique index on recall_msg_id, so one of them hits a transaction conflict, and its retry finds the first
    // one's row. The index is what makes a second copy impossible. (INSERT IGNORE would skip the duplicate too, but
    // SurrealDB 3.3.2 also ignores every other error with it, such as an event for a session that doesn't exist.)
    async addEvent(e: { sessionId: string; recallMsgId: string | null; kind: string; speaker: string | null; text: string | null }): Promise<StoredEvent | null> {
      const [row] = await run<[EventRow | undefined]>(
        `IF $msg != NONE AND array::len(SELECT VALUE id FROM events WHERE recall_msg_id = $msg LIMIT 1) > 0 { NONE } ELSE {
          CREATE ONLY type::record("events", sequence::nextval("events_id"))
            CONTENT { session_id: $sid, recall_msg_id: $msg, kind: $kind, speaker: $speaker, text: $text, created_at: $now }
        }`,
        { sid: sessionRef(e.sessionId), msg: none(e.recallMsgId), kind: e.kind, speaker: none(e.speaker), text: none(e.text), now: now() });
      return row ? toEvent(row) : null;
    },
    async recentUtterances(sessionId: string, limit: number): Promise<{ speaker: string | null; text: string | null }[]> {
      const [rows] = await run<[EventRow[]]>(
        `SELECT id, speaker, text FROM events WHERE session_id = $sid AND kind = "utterance" ORDER BY id DESC LIMIT $limit`,
        { sid: sessionRef(sessionId), limit });
      return rows.map((r) => ({ speaker: r.speaker ?? null, text: r.text ?? null })).reverse();
    },
    async listEvents(sessionId: string): Promise<StoredEvent[]> {
      const [rows] = await run<[EventRow[]]>("SELECT * FROM events WHERE session_id = $sid ORDER BY id", { sid: sessionRef(sessionId) });
      return rows.map(toEvent);
    },
    // A row that no longer parses (written by older code, say) reads as absent, so the session starts
    // from a fresh doc instead of throwing on every later event.
    async getConsensus(sessionId: string): Promise<{ doc: ConsensusDoc; proto: Prototype } | undefined> {
      const [[row]] = await run<[{ doc_json: Opt<string>; proto_json: Opt<string> }[]]>(
        "SELECT doc_json, proto_json FROM $id", { id: new RecordId("consensus", sessionId) });
      if (!row) return undefined;
      const json = (text: Opt<string>): unknown => { try { return JSON.parse(text ?? ""); } catch { return undefined; } };
      const doc = ConsensusDocSchema.safeParse(json(row.doc_json));
      const proto = PrototypeSchema.safeParse(json(row.proto_json));
      if (!doc.success || !proto.success) {
        log("store.consensus_invalid", { session_id: sessionId, doc_ok: doc.success, proto_ok: proto.success });
        return undefined;
      }
      return { doc: doc.data, proto: proto.data };
    },
    async saveConsensus(sessionId: string, doc: ConsensusDoc, proto: Prototype): Promise<void> {
      await run("UPSERT $id SET doc_json = $doc, proto_json = $proto, updated_at = $now RETURN NONE",
        { id: new RecordId("consensus", sessionId), doc: JSON.stringify(doc), proto: JSON.stringify(proto), now: now() });
    },
    async addModelCall(c: { sessionId: string; loop: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; usd: number; ms: number }): Promise<void> {
      await run(`INSERT INTO model_calls { id: sequence::nextval("model_calls_id"), session_id: $sid, loop: $loop, model: $model,
          input_tokens: $input, output_tokens: $output, cache_read_tokens: $cacheRead, cache_write_tokens: $cacheWrite, usd: $usd, ms: $ms,
          created_at: $now } RETURN NONE`, {
        sid: c.sessionId, loop: c.loop, model: c.model, input: c.inputTokens, output: c.outputTokens, cacheRead: c.cacheReadTokens,
        cacheWrite: c.cacheWriteTokens, usd: c.usd, ms: Math.round(c.ms), now: now(),
      });
    },
    async listModelCalls(sessionId: string): Promise<ModelCall[]> {
      const [rows] = await run<[ModelCallRow[]]>("SELECT * FROM model_calls WHERE session_id = $sid ORDER BY id", { sid: sessionId });
      return rows.map((r) => ({ ...r, id: r.id.id, created_at: iso(r.created_at) }));
    },
    async sessionCost(sessionId: string): Promise<number> {
      const [total] = await run<[number]>("RETURN math::sum((SELECT VALUE usd FROM model_calls WHERE session_id = $sid))", { sid: sessionId });
      return total;
    },
    // Ends the connection (in-process: shuts the database down and releases its folder). A process that opened
    // a store must close it to exit cleanly. Safe to call more than once.
    close(): Promise<void> {
      closing ??= db.close().then(() => {});
      return closing;
    },
  };
}

export type Store = Awaited<ReturnType<typeof openStore>>;
