-- Sets up SurrealDB for Builder on a local server (docker-compose.yml) and in CI (docs/adr/0011-surrealdb.md):
-- namespace builder, a database per app, and a database-level user per app with the OWNER role on its own database
-- only. OWNER because each app's migrations define sequences, which an EDITOR can't. Run as a root user.
--
-- SurrealDB Cloud is set up with infra/surrealdb/make-user.ts instead, so no password is typed into Surrealist.
--
-- The two passwords are placeholders, {{engine_pass}} and {{api_pass}}. SurrealQL takes only a literal string after
-- PASSWORD (3.3.2 refuses a $parameter there), so infra/surrealdb/setup.sh replaces every occurrence of each
-- (replace-all) just before the script runs, and refuses to send it if any placeholder is left. Don't fill it in by
-- hand. The guards below also stop the whole transaction if a password is shorter than 32 characters or has anything
-- but letters, digits, - and _.
--
-- Safe to run again: it keeps the namespace, the databases and their data, and sets each user's password to the one
-- given.

BEGIN TRANSACTION;

DEFINE NAMESPACE IF NOT EXISTS builder;
USE NS builder;

DEFINE DATABASE IF NOT EXISTS engine;
USE DB engine;
IF !string::matches("{{engine_pass}}", <regex> "^[A-Za-z0-9_-]{32,}$") {
  THROW "The engine password must be 32 or more letters, digits, - or _";
};
DEFINE USER OVERWRITE engine ON DATABASE PASSWORD "{{engine_pass}}" ROLES OWNER;

DEFINE DATABASE IF NOT EXISTS api;
USE DB api;
IF !string::matches("{{api_pass}}", <regex> "^[A-Za-z0-9_-]{32,}$") {
  THROW "The api password must be 32 or more letters, digits, - or _";
};
DEFINE USER OVERWRITE api ON DATABASE PASSWORD "{{api_pass}}" ROLES OWNER;

COMMIT TRANSACTION;
