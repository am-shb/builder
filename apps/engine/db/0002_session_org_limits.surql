-- Sessions started by the api (POST /internal/sessions, docs/adr/0008-api-engine-boundary.md) belong to an org and
-- carry its per-session limits. E4 in docs/plans/api-first-slice.md.
--
-- All three are optional, so rows written before this file stay valid, and sessions the operator starts from the
-- local routes (/api/sessions, local mode) have no org. NONE means "no org" and "no limit".
-- Enforcing the limits comes later (ADR 0008); for now they are stored.

DEFINE FIELD org_id ON sessions TYPE option<string>;
DEFINE FIELD max_usd ON sessions TYPE option<number>;
DEFINE FIELD max_minutes ON sessions TYPE option<number>;

-- "Is there an active session for this meeting?" is asked within one org (E3), so it looks up both.
DEFINE INDEX sessions_org_meeting ON sessions FIELDS org_id, meeting_url;
