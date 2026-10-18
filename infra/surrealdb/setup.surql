-- Sets up SurrealDB for Builder (docs/adr/0011-surrealdb.md): namespace builder, a database per app, and a
-- database-level user per app with the OWNER role on its own database only. OWNER because each app's migrations
-- define sequences, which an EDITOR can't. Run it as a root user.
--
-- The two passwords are placeholders, {{engine_pass}} and {{api_pass}}. SurrealQL takes only a literal string after
-- PASSWORD (3.3.2 refuses a $parameter there), so they are replaced just before the script runs, and never saved:
-- - SurrealDB Cloud: paste the script into Surrealist's query editor, replace both placeholders there, run it, and
--   don't save the query (docs/runbooks/README.md).
-- - docker-compose.yml and CI: infra/surrealdb/setup.sh does the replacing.
-- The script changes nothing while a placeholder is left, or while a password is shorter than 32 characters or has
-- anything but letters, digits, - and _ (`openssl rand -hex 32` makes a good one).
--
-- Safe to run again: it keeps the namespace, the databases and their data, and sets each user's password to the one
-- given, so running it with new passwords rotates them.

BEGIN TRANSACTION;

DEFINE NAMESPACE IF NOT EXISTS builder;
USE NS builder;

DEFINE DATABASE IF NOT EXISTS engine;
USE DB engine;
IF !string::matches("{{engine_pass}}", <regex> "^[A-Za-z0-9_-]{32,}$") {
  THROW "Replace {{engine_pass}} with a password of 32 or more letters, digits, - or _";
};
DEFINE USER OVERWRITE engine ON DATABASE PASSWORD "{{engine_pass}}" ROLES OWNER;

DEFINE DATABASE IF NOT EXISTS api;
USE DB api;
IF !string::matches("{{api_pass}}", <regex> "^[A-Za-z0-9_-]{32,}$") {
  THROW "Replace {{api_pass}} with a password of 32 or more letters, digits, - or _";
};
DEFINE USER OVERWRITE api ON DATABASE PASSWORD "{{api_pass}}" ROLES OWNER;

COMMIT TRANSACTION;
