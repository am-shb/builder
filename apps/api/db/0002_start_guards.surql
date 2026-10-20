-- Limits on starting sessions, and a stopgap for statuses that never move (docs/plans/api-first-slice.md, "Start
-- guards"). Applied once by src/db/migrate.ts.
--
-- Until the engine's status events arrive (A2), a session stays `joining` forever, so it would block its meeting link
-- for good. `active_until` is when a session stops counting as active even if no event said so: its time limit plus a
-- margin (the lobby wait and the engine's leave), after which the engine has ended the bot anyway.
-- `active_meeting` (the unique index's field) is recomputed on every write, so src/db/sessions.ts rewrites an org's
-- expired rows before it looks for an active one, and they drop out. NONE means no limit, kept for rows written by an
-- older api (the backfill below sets it for those that exist now; the start transaction sets it for later ones).
DEFINE FIELD active_until ON session TYPE option<datetime>;
DEFINE FIELD OVERWRITE active_meeting ON session TYPE option<string>
  VALUE IF status IN ["starting", "joining", "in_meeting"] AND (active_until = NONE OR active_until > time::now()) { meeting_url } ELSE { NONE };

-- The per-person limits count a person's sessions across every org.
DEFINE INDEX session_creator_created ON session FIELDS created_by, created_at;

-- Written by every start, in the start's transaction: the org's row and the person's row. Two starts at once for one
-- org or one person then write the same record, so one conflicts and is retried after the other: the counts behind
-- the limits can't be read by both before either has created its session.
DEFINE FIELD last_start_at ON org TYPE option<datetime>;
DEFINE TABLE starter SCHEMAFULL;
DEFINE FIELD last_start_at ON starter TYPE datetime;

-- Sessions that may have a bot now (start_unknown included: one may exist): their time limit plus a margin of 30
-- minutes, the default. Only these, so finished sessions keep their `updated_at`.
UPDATE session SET active_until = created_at + duration::from_secs(math::round((max_minutes + 30) * 60))
  WHERE active_until = NONE AND status IN ["starting", "joining", "in_meeting", "start_unknown"];
