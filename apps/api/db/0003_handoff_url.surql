-- The session's handoff page (ADR 0008, "Delivering the hand-off link"): the engine's link, read-only token included,
-- from its `handoff.ready` event once the meeting ends. Shown to members of the session's org, never in the list, never
-- logged. NONE until the event arrives, and for sessions that ended before the engine sent it. Applied once by
-- src/db/migrate.ts.
DEFINE FIELD handoff_url ON session TYPE option<string>;
