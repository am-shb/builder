// Opens the engine's database (docs/adr/0007-database.md). With a DATABASE_URL it's Postgres through a `pg`
// pool, whose schema `npm run migrate` keeps current (Render's pre-deploy command). Without one it's PGlite,
// Postgres compiled to WASM and run in this process, migrated here on open: in memory for tests and smoke, or
// in a data directory for `npm start` and `npm run local` on a laptop.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type Log = (msg: string, fields?: Record<string, unknown>) => void;

// The migrations table sits in the engine's schema, so the api's migrations (in its own schema) never mix in.
export const MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
  migrationsSchema: "engine",
  migrationsTable: "__drizzle_migrations",
};

export type DbTarget = {
  // Postgres connection string. Absent or null: PGlite.
  databaseUrl?: string | null;
  // PGlite data directory. Absent: in memory, gone when the process exits.
  dataDir?: string;
};

export { errorCode } from "../error-code.ts";
import { errorCode } from "../error-code.ts";

export async function connect(target: DbTarget, log: Log = () => {}): Promise<{ db: Db; close(): Promise<void> }> {
  if (target.databaseUrl) {
    const pool = new pg.Pool({ connectionString: target.databaseUrl });
    // An idle client can lose its connection; without a listener that error would end the process.
    pool.on("error", (err) => log("store.pool_error", { error: errorCode(err) }));
    return { db: drizzlePg(pool, { schema }) as unknown as Db, close: () => pool.end() };
  }
  const client = target.dataDir ? await openPgliteDir(target.dataDir) : await PGlite.create({ loadDataDir: await memoryTemplate() });
  return { db: drizzlePglite(client, { schema }) as unknown as Db, close: () => client.close() };
}

// Applies the committed migrations in drizzle/. Safe to run again: applied ones are skipped.
export async function migrate(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migratePg(drizzlePg(pool), MIGRATIONS);
  } finally {
    await pool.end();
  }
}

async function openPgliteDir(dataDir: string): Promise<PGlite> {
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  try {
    await migratePglite(drizzlePglite(client), MIGRATIONS);
  } catch (err) {
    await client.close();
    throw err;
  }
  return client;
}

// Starting PGlite and migrating takes most of a second, and tests open a store per test. So each process
// migrates one in-memory database once, keeps a dump of it, and starts every in-memory store from that dump.
let template: Promise<Blob> | undefined;
function memoryTemplate(): Promise<Blob> {
  template ??= (async () => {
    const client = new PGlite();
    try {
      await migratePglite(drizzlePglite(client), MIGRATIONS);
      return await client.dumpDataDir("none");
    } finally {
      await client.close();
    }
  })().catch((err) => {
    template = undefined;
    throw err;
  });
  return template;
}
