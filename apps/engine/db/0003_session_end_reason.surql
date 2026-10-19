-- Why the engine ended a session itself (known issue R1, docs/adr/0008-api-engine-boundary.md): "max_minutes" or
-- "max_usd" when it reached one of its limits. Set once, when the engine decides to leave, and kept after the bot
-- has left. Optional, so rows written before this file stay valid; NONE means the engine didn't end it.

DEFINE FIELD end_reason ON sessions TYPE option<string> ASSERT $value == NONE OR $value IN ["max_minutes", "max_usd"];
