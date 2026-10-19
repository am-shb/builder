-- What a session costs besides model calls (src/service-costs.ts): one row per line sent to TTS, and one per Recall
-- charge (bot time, transcription) once the bot has ended. The id makes a write idempotent: the utterance id for a
-- line, "<session>:recall_bot" or "<session>:recall_transcript" for Recall, so a write sent again is stored once.
-- `quantity` is in `unit`: characters for TTS, seconds for Recall. `seq` keeps the order rows were written in.

DEFINE TABLE service_costs SCHEMAFULL;
DEFINE FIELD session_id ON service_costs TYPE string;
DEFINE FIELD kind ON service_costs TYPE string ASSERT $value IN ["tts", "recall_bot", "recall_transcript"];
DEFINE FIELD quantity ON service_costs TYPE number;
DEFINE FIELD unit ON service_costs TYPE string ASSERT $value IN ["chars", "seconds"];
DEFINE FIELD usd ON service_costs TYPE float;
DEFINE FIELD seq ON service_costs TYPE int;
DEFINE FIELD created_at ON service_costs TYPE datetime;
DEFINE INDEX service_costs_session ON service_costs FIELDS session_id;
DEFINE SEQUENCE service_costs_seq START 1;
