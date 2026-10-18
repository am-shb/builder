// Databases for tests: SurrealDB in this process, in memory, migrated, one per call. All are closed when the file's
// tests end, since an open in-process SurrealDB keeps the process alive. Never a server, never SurrealDB Cloud.
import { after } from "node:test";
import { openDb } from "../../src/db/index.ts";
import type { Db } from "../../src/db/index.ts";
import { connect } from "../../src/db/connect.ts";
import { migrate } from "../../src/db/migrate.ts";

type Raw = Awaited<ReturnType<typeof connect>>;
const open = new Set<{ close(): Promise<unknown> }>();
after(() => Promise.all([...open].map((d) => d.close())));

export async function testDb(): Promise<Db> {
  const db = await openDb();
  open.add(db);
  return db;
}

/** The SurrealDB connection itself, migrated, for checking what the schema refuses. */
export async function rawDb(): Promise<Raw> {
  const db = await connect();
  open.add(db);
  await migrate(db);
  return db;
}
