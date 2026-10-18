// `npm run migrate -w @builder/engine`: applies the engine's migrations to the Postgres in DATABASE_URL.
// Render runs it as the pre-deploy command. It needs production dependencies only (drizzle-orm and pg), not
// drizzle-kit. PGlite databases (tests, smoke, local) are migrated when they open, so they don't need it.
import { existsSync } from "node:fs";
import { migrate, errorCode } from "./connect.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. Nothing to migrate: without it the engine uses PGlite, which migrates itself.");
  process.exit(1);
}
try {
  await migrate(url);
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: "db.migrated" }));
} catch (err) {
  // The code only: a message can carry connection details.
  console.error(JSON.stringify({ t: new Date().toISOString(), msg: "db.migrate_failed", error: errorCode(err) }));
  process.exit(1);
}
