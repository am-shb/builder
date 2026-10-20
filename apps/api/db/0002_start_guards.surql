-- Limits on starting sessions, and a stopgap for statuses that never move (docs/plans/api-first-slice.md, "Start
-- guards"). Applied once by src/db/migrate.ts.
--
-- Until the engine's status events arrive (A2), a session stays `joining` forever, so it would block its meeting link
-- for good. `active_until` is when a session stops counting as active even if no event said so: its time limit plus a
-- margin, after which the engine has ended the bot anyway. `active_meeting` (the unique index's field) is recomputed
-- on every write, so src/db/sessions.ts rewrites an org's active rows before it looks for one, and expired rows drop
-- out. NONE means no limit, kept for rows written before this file (the backfill below sets it for those).
DEFINE FIELD active_until ON session TYPE option<datetime>;
DEFINE FIELD OVERWRITE active_meeting ON session TYPE option<string>
  VALUE IF status IN ["starting", "joining", "in_meeting"] AND (active_until = NONE OR active_until > time::now()) { meeting_url } ELSE { NONE };

-- Written by every start, in the start's transaction. Two starts for one org at once then write the same record, so
-- one of them conflicts and is retried after the other: the counts behind the caps can't be read by both before
-- either has created its session.
DEFINE FIELD last_start_at ON org TYPE option<datetime>;

-- Existing sessions: their time limit plus the default margin of 10 minutes.
UPDATE session SET active_until = created_at + duration::from_secs(math::round((max_minutes + 10) * 60)) WHERE active_until = NONE;
