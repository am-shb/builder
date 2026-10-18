// Stores for tests, all closed when the file's tests end (closing twice is fine). An open in-process SurrealDB
// keeps the process alive, so a test file that left one open would never exit. In memory unless given a path.
//
// Against a real server instead (ADR 0011; CI's real-server job): set TEST_SURREAL_URL (ws://...) and a root user in
// TEST_SURREAL_USER and TEST_SURREAL_PASS. Each store that would be in memory is then a new database of its own on
// that server, migrated, and removed when the file's tests end, so tests and files never share data. A store given
// a path stays in this process.
import { after } from "node:test";
import { randomBytes } from "node:crypto";
import { openStore } from "../../src/store.ts";
import type { Store } from "../../src/store.ts";
import { connect, NAMESPACE } from "../../src/db/connect.ts";
import type { DbTarget } from "../../src/db/connect.ts";
import { migrate } from "../../src/db/migrate.ts";

const server: DbTarget | null = process.env.TEST_SURREAL_URL?.trim()
  ? { url: process.env.TEST_SURREAL_URL.trim(), user: process.env.TEST_SURREAL_USER, pass: process.env.TEST_SURREAL_PASS, auth: "root" }
  : null;
const databases: string[] = [];

const open = new Set<Store>();
after(async () => {
  await Promise.all([...open].map((s) => s.close()));
  if (!server || !databases.length) return;
  const db = await connect(server);
  try {
    for (const name of databases) await db.query(`REMOVE DATABASE IF EXISTS ${name}`).collect();
  } finally {
    await db.close();
  }
});

// A new, migrated database on the test server.
async function serverDatabase(): Promise<DbTarget> {
  const database = `test_${process.pid}_${databases.length}_${randomBytes(4).toString("hex")}`;
  const target = { ...server, database };
  const db = await connect(target);
  try {
    await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${NAMESPACE}; USE NS ${NAMESPACE}; DEFINE DATABASE IF NOT EXISTS ${database};`).collect();
    databases.push(database);
    await migrate(db);
  } finally {
    await db.close();
  }
  return target;
}

// The in-process SurrealDB answers from its own threads, so a query isn't done after a fixed number of event-loop
// turns. Every test store counts its calls in flight, and settle() waits for them.
const inFlight = new Set<Promise<unknown>>();

function tracked(store: Store): Store {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(store)) {
    out[name] = typeof value !== "function" ? value : (...args: unknown[]) => {
      const p = Promise.resolve((value as (...a: unknown[]) => unknown)(...args));
      inFlight.add(p);
      p.finally(() => inFlight.delete(p)).catch(() => {});
      return p;
    };
  }
  return out as Store;
}

export async function testStore(opts: Parameters<typeof openStore>[0] = {}): Promise<Store> {
  const target = server && !opts.path && !opts.url ? await serverDatabase() : {};
  const store = tracked(await openStore({ ...opts, ...target }));
  open.add(store);
  return store;
}

/**
 * Lets queued work run: `turns` event-loop turns, then, while any test store call is in flight, waits for it and
 * gives the code after it the same turns. Fake timers don't advance.
 */
export async function settle(turns = 20): Promise<void> {
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < turns; i++) await new Promise<void>((r) => setImmediate(r));
    if (inFlight.size === 0) return;
    await Promise.allSettled([...inFlight]);
  }
  throw new Error("store calls still in flight after 100 rounds");
}
