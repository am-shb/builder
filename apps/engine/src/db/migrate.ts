// The engine's schema migrations: the SurrealQL files in apps/engine/db/, applied in name order, each once. Each
// file runs in one transaction together with its row in the `migration` table, so a file is applied whole or not
// at all, and a run that fails halfway leaves the files before it applied. Running it again is a no-op.
//
// In-process databases (tests, smoke, `npm start` and `npm run local` without SURREAL_URL) are migrated when the
// store opens them. A server is migrated by `npm run migrate -w @builder/engine`, Render's pre-deploy command,
// which runs this file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RecordId, surql } from "surrealdb";
import type { Surreal } from "surrealdb";
import { connect } from "./connect.ts";
import { surrealSettings } from "../config.ts";
import { errorCode } from "../error-code.ts";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/", import.meta.url));

const LEDGER = `
  DEFINE TABLE IF NOT EXISTS migration SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS applied_at ON migration TYPE datetime;
`;

/** Applies the files not applied yet, in name order. Returns the names it applied. */
export async function migrate(db: Surreal, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(LEDGER).retry().collect();
  const [done] = await db.query<[string[]]>("SELECT VALUE record::id(id) FROM migration").collect();
  const applied = new Set(done);
  const files = readdirSync(dir).filter((f) => f.endsWith(".surql")).sort();
  const ran: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    // A second runner racing this one fails on the migration row, and its transaction undoes the file with it.
    await db.transaction([readFileSync(`${dir}/${name}`, "utf8"), surql`CREATE ${new RecordId("migration", name)} SET applied_at = time::now()`]);
    ran.push(name);
  }
  return ran;
}

if (import.meta.main) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const log = (msg: string, fields?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }));
  // A bad setting throws here with a message naming the variable, never its value.
  const settings = surrealSettings(process.env);
  if (!settings.url) {
    console.error("SURREAL_URL is not set. Nothing to migrate: without it the engine runs SurrealDB in its own process and migrates it on start.");
    process.exit(1);
  }
  let db: Surreal | undefined;
  try {
    db = await connect(settings);
    const ran = await migrate(db);
    log("db.migrated", { applied: ran.length, files: ran });
    await db.close();
  } catch (err) {
    // The code only: a message can carry connection details or schema values.
    log("db.migrate_failed", { error: errorCode(err) });
    await db?.close().catch(() => {});
    // An unreachable server leaves the SDK's next reconnect attempt scheduled, which would hold the exit back.
    process.exit(1);
  }
}
