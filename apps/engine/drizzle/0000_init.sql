CREATE SCHEMA IF NOT EXISTS "engine";
--> statement-breakpoint
CREATE TABLE "engine"."consensus" (
	"session_id" text PRIMARY KEY NOT NULL,
	"doc_json" text,
	"proto_json" text,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engine"."events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "engine"."events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" text NOT NULL,
	"recall_msg_id" text,
	"kind" text NOT NULL,
	"speaker" text,
	"text" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "events_recall_msg_id_unique" UNIQUE("recall_msg_id")
);
--> statement-breakpoint
CREATE TABLE "engine"."model_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "engine"."model_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" text NOT NULL,
	"loop" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"usd" double precision NOT NULL,
	"ms" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_url" text NOT NULL,
	"state" text NOT NULL,
	"bot_id" text,
	"bot_status" text,
	"bot_sub_code" text,
	"error" text,
	"stage_token" text,
	"handoff_token" text,
	"stage_html" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_bot_id_unique" UNIQUE("bot_id")
);
--> statement-breakpoint
ALTER TABLE "engine"."events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "engine"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_session" ON "engine"."events" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "model_calls_session" ON "engine"."model_calls" USING btree ("session_id");