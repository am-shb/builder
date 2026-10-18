// Databases for tests: SurrealDB in this process, in memory, migrated, one per call. All are closed when the file's
// tests end, since an open in-process SurrealDB keeps the process alive. Never SurrealDB Cloud.
//
// Against a real server instead (ADR 0011; CI's real-server job): set TEST_SURREAL_URL (ws://...) and a root user in
// TEST_SURREAL_USER and TEST_SURREAL_PASS. Each call then gets a new database of its own on that server, migrated,
// and removed when the file's tests end, so tests and files never share data.
import { after } from "node:test";
import { randomBytes } from "node:crypto";
import { openDb } from "../../src/db/index.ts";
import type { Db } from "../../src/db/index.ts";
import { connect, NAMESPACE } from "../../src/db/connect.ts";
import type { DbTarget } from "../../src/db/connect.ts";
import { migrate } from "../../src/db/migrate.ts";

type Raw = Awaited<ReturnType<typeof connect>>;
const server: DbTarget | null = process.env.TEST_SURREAL_URL?.trim()
  ? { url: process.env.TEST_SURREAL_URL.trim(), user: process.env.TEST_SURREAL_USER, pass: process.env.TEST_SURREAL_PASS, auth: "root" }
  : null;
const databases: string[] = [];

const open = new Set<{ close(): Promise<unknown> }>();
after(async () => {
  await Promise.all([...open].map((d) => d.close()));
  if (!server || !databases.length) return;
  const db = await connect(server);
  try {
    for (const name of databases) await db.query(`REMOVE DATABASE IF EXISTS ${name}`).collect();
  } finally {
    await db.close();
  }
});

// A new, migrated database on the test server, or {} for one in memory.
async function target(): Promise<DbTarget> {
  if (!server) return {};
  const database = `test_${process.pid}_${databases.length}_${randomBytes(4).toString("hex")}`;
  const t = { ...server, database };
  const db = await connect(t);
  try {
    await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${NAMESPACE}; USE NS ${NAMESPACE}; DEFINE DATABASE IF NOT EXISTS ${database};`).collect();
    databases.push(database);
    await migrate(db);
  } finally {
    await db.close();
  }
  return t;
}

export async function testDb(): Promise<Db> {
  const db = await openDb(await target());
  open.add(db);
  return db;
}

/** The SurrealDB connection itself, migrated, for checking what the schema refuses. */
export async function rawDb(): Promise<Raw> {
  const db = await connect(await target());
  open.add(db);
  await migrate(db);
  return db;
}
