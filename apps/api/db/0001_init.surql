-- The api's first schema (docs/adr/0011-surrealdb.md), in namespace `builder`, database `api`. The plan is
-- docs/plans/api-first-slice.md, step 3. Applied once by src/db/migrate.ts, so plain DEFINE, as in the engine.
--
-- - An org's record id is its Clerk org id: org:⟨org_…⟩. Created on the org's first request (D4).
-- - A session's record id is the api's randomUUID(), the same id it sends the engine.
-- - Every session belongs to one org, and every query on sessions filters by it (src/db/sessions.ts).

DEFINE TABLE org SCHEMAFULL;
DEFINE FIELD created_at ON org TYPE datetime DEFAULT time::now() READONLY;

DEFINE TABLE session SCHEMAFULL;
DEFINE FIELD org ON session TYPE record<org>;
-- The Clerk user id of whoever started it.
DEFINE FIELD created_by ON session TYPE string;
DEFINE FIELD meeting_url ON session TYPE string;
-- The contract's four SessionStatus values, plus three of the api's own (D6): starting (row written, the engine
-- hasn't answered), start_failed (the engine said no) and start_unknown (no answer: a bot may or may not exist).
DEFINE FIELD status ON session TYPE string
  ASSERT $value IN ["starting", "start_failed", "start_unknown", "joining", "in_meeting", "ended", "failed"];
DEFINE FIELD error_code ON session TYPE option<string>;
DEFINE FIELD stage_url ON session TYPE option<string>;
DEFINE FIELD max_usd ON session TYPE number;
DEFINE FIELD max_minutes ON session TYPE number;
DEFINE FIELD created_at ON session TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD updated_at ON session TYPE datetime VALUE time::now();
-- The meeting URL while the session is active (a bot is, or may be about to be, in the meeting), NONE otherwise.
-- The unique index allows one active session per org and meeting, even if two requests race (D7). Absent values
-- don't clash, so ended and failed sessions don't count.
DEFINE FIELD active_meeting ON session TYPE option<string>
  VALUE IF status IN ["starting", "joining", "in_meeting"] { meeting_url } ELSE { NONE };

DEFINE INDEX session_org_created ON session FIELDS org, created_at;
DEFINE INDEX session_org_meeting ON session FIELDS org, meeting_url;
DEFINE INDEX session_org_active ON session FIELDS org, active_meeting UNIQUE;
