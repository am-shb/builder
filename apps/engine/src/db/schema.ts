// The engine's tables, in its own Postgres schema (docs/adr/0007-database.md). The api owns the `api` schema;
// neither app reads the other's tables. Column keys are snake_case so rows come back in the shapes store.ts
// returns. Change a table here, then run `npx drizzle-kit generate` in apps/engine and commit the new migration.
import { pgSchema, text, bigint, integer, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";

export const engine = pgSchema("engine");

// Timestamps are timestamptz. The store hands them out as ISO strings, as the SQLite store did.
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const sessions = engine.table("sessions", {
  id: text("id").primaryKey(),
  meeting_url: text("meeting_url").notNull(),
  state: text("state").notNull(),
  bot_id: text("bot_id").unique(),
  bot_status: text("bot_status"),
  bot_sub_code: text("bot_sub_code"),
  error: text("error"),
  stage_token: text("stage_token"),
  handoff_token: text("handoff_token"),
  stage_html: text("stage_html"),
  created_at: at("created_at").notNull(),
  updated_at: at("updated_at").notNull(),
});

export const events = engine.table("events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  session_id: text("session_id").notNull().references(() => sessions.id),
  // Recall's webhook id. Unique, so a redelivered event is stored once (NULLs, for our own lines, never clash).
  recall_msg_id: text("recall_msg_id").unique(),
  kind: text("kind").notNull(),
  speaker: text("speaker"),
  text: text("text"),
  created_at: at("created_at").notNull(),
}, (t) => [index("events_session").on(t.session_id, t.id)]);

// The decision document and prototype, as JSON text: a row that no longer parses must read as absent, not fail.
export const consensus = engine.table("consensus", {
  session_id: text("session_id").primaryKey(),
  doc_json: text("doc_json"),
  proto_json: text("proto_json"),
  updated_at: at("updated_at"),
});

export const modelCalls = engine.table("model_calls", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  session_id: text("session_id").notNull(),
  loop: text("loop").notNull(),
  model: text("model").notNull(),
  input_tokens: integer("input_tokens").notNull(),
  output_tokens: integer("output_tokens").notNull(),
  cache_read_tokens: integer("cache_read_tokens").notNull(),
  cache_write_tokens: integer("cache_write_tokens").notNull(),
  usd: doublePrecision("usd").notNull(),
  ms: integer("ms").notNull(),
  created_at: at("created_at").notNull(),
}, (t) => [index("model_calls_session").on(t.session_id)]);
