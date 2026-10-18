-- The engine's first schema (docs/adr/0011-surrealdb.md), in namespace `builder`, database `engine`. It mirrors the
-- SQLite tables and columns the engine had before, so `src/store.ts` returns the same values as it did then.
--
-- How SQLite maps here:
-- - A TEXT primary key is the record id: `sessions:⟨uuid⟩`, and `consensus:⟨session id⟩`. The store returns the key
--   (the uuid) as `id`, a string, as before.
-- - An INTEGER AUTOINCREMENT id is a number record id from a sequence: `events:1`, `model_calls:1`. The store returns
--   the number. Ids grow in the order rows are written, so ORDER BY id is still the order of arrival. A write that
--   fails or is ignored can leave a gap, and the sequence hands out ids in batches, so after a restart they jump.
-- - A nullable column is `option<...>`: an absent field (NONE), which the store returns as null. NULL is not stored.
-- - A timestamp column is a `datetime`. The store writes the engine's clock (millisecond precision) and returns
--   ISO strings, as before.
-- - events.session_id was a foreign key to sessions: it's a record link that must point at an existing session.
--   model_calls.session_id and the consensus key had no foreign key, so they are plain strings.
-- - A UNIQUE column has a UNIQUE index. Absent values don't clash, as NULLs didn't in SQLite.

DEFINE TABLE sessions SCHEMAFULL;
DEFINE FIELD meeting_url ON sessions TYPE string;
DEFINE FIELD state ON sessions TYPE string ASSERT $value IN ["intent", "created", "create_failed"];
DEFINE FIELD bot_id ON sessions TYPE option<string>;
DEFINE FIELD bot_status ON sessions TYPE option<string>;
DEFINE FIELD bot_sub_code ON sessions TYPE option<string>;
DEFINE FIELD error ON sessions TYPE option<string>;
DEFINE FIELD stage_token ON sessions TYPE option<string>;
-- Read-only capability for the handoff page; never the stage token, which also opens the stage socket.
DEFINE FIELD handoff_token ON sessions TYPE option<string>;
DEFINE FIELD stage_html ON sessions TYPE option<string>;
DEFINE FIELD created_at ON sessions TYPE datetime;
DEFINE FIELD updated_at ON sessions TYPE datetime;
DEFINE INDEX sessions_bot_id ON sessions FIELDS bot_id UNIQUE;
DEFINE INDEX sessions_meeting_url ON sessions FIELDS meeting_url;

DEFINE TABLE events SCHEMAFULL;
DEFINE FIELD session_id ON events TYPE record<sessions> ASSERT record::exists($value);
-- A Recall message is stored once: the store skips an id it finds, and this index refuses a second copy.
DEFINE FIELD recall_msg_id ON events TYPE option<string>;
DEFINE FIELD kind ON events TYPE string;
DEFINE FIELD speaker ON events TYPE option<string>;
DEFINE FIELD text ON events TYPE option<string>;
DEFINE FIELD created_at ON events TYPE datetime;
DEFINE INDEX events_recall_msg_id ON events FIELDS recall_msg_id UNIQUE;
DEFINE INDEX events_session ON events FIELDS session_id;
DEFINE SEQUENCE events_id START 1;

DEFINE TABLE consensus SCHEMAFULL;
DEFINE FIELD doc_json ON consensus TYPE option<string>;
DEFINE FIELD proto_json ON consensus TYPE option<string>;
DEFINE FIELD updated_at ON consensus TYPE option<datetime>;

DEFINE TABLE model_calls SCHEMAFULL;
DEFINE FIELD session_id ON model_calls TYPE string;
DEFINE FIELD loop ON model_calls TYPE string;
DEFINE FIELD model ON model_calls TYPE string;
DEFINE FIELD input_tokens ON model_calls TYPE int;
DEFINE FIELD output_tokens ON model_calls TYPE int;
DEFINE FIELD cache_read_tokens ON model_calls TYPE int;
DEFINE FIELD cache_write_tokens ON model_calls TYPE int;
DEFINE FIELD usd ON model_calls TYPE float;
DEFINE FIELD ms ON model_calls TYPE int;
DEFINE FIELD created_at ON model_calls TYPE datetime;
DEFINE INDEX model_calls_session ON model_calls FIELDS session_id;
DEFINE SEQUENCE model_calls_id START 1;
