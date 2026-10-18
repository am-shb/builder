// The SurrealQL migration runner (src/db/migrate.ts) and connect.ts, on the in-process engine. Follows the
// engine's test/migrate.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../src/db/connect.ts";
import { migrate, MIGRATIONS_DIR } from "../src/db/migrate.ts";
import { openDb } from "../src/db/index.ts";
import { errorCode } from "../src/error-code.ts";

const dirWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "api-migrations-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

type Raw = Awaited<ReturnType<typeof connect>>;
async function withDb(fn: (db: Raw) => Promise<void>) {
  const db = await connect();
  try {
    await fn(db);
  } finally {
    await db.close();
  }
}

const ledger = async (db: Raw) =>
  (await db.query<[{ name: string }[]]>("SELECT record::id(id) AS name FROM migration ORDER BY name").collect())[0].map((r) => r.name);

test("the api's own migrations apply to a new database, and a second run is a no-op", async () => {
  await withDb(async (db) => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".surql")).sort();
    assert.ok(files.includes("0001_init.surql"));
    assert.deepEqual(await migrate(db), files);
    assert.deepEqual(await migrate(db), []);
    assert.deepEqual(await ledger(db), files, "each file is recorded once");
    const [info] = await db.query<[{ tables: Record<string, unknown> }]>("INFO FOR DB").collect();
    assert.deepEqual(Object.keys(info.tables).sort(), ["migration", "org", "session"]);
  });
});

test("files apply in name order, each once, and later files are picked up by a later run", async () => {
  const dir = dirWith({
    "0002_b.surql": "DEFINE FIELD b ON t TYPE string;",
    "0001_a.surql": "DEFINE TABLE t SCHEMAFULL; DEFINE FIELD a ON t TYPE string;",
  });
  await withDb(async (db) => {
    assert.deepEqual(await migrate(db, dir), ["0001_a.surql", "0002_b.surql"], "0002 needs 0001's table, so order matters");
    writeFileSync(join(dir, "0003_c.surql"), "DEFINE FIELD c ON t TYPE option<string>;");
    assert.deepEqual(await migrate(db, dir), ["0003_c.surql"]);
  });
});

test("a failing file applies nothing, leaves no row and stops the run; the files before it stay applied", async () => {
  const dir = dirWith({
    "0001_ok.surql": "DEFINE TABLE ok SCHEMAFULL;",
    "0002_bad.surql": "DEFINE TABLE half SCHEMAFULL; DEFINE FIELD x ON half TYPE string; CREATE half:1 SET x = 1;",
    "0003_after.surql": "DEFINE TABLE after SCHEMAFULL;",
  });
  await withDb(async (db) => {
    await assert.rejects(migrate(db, dir));
    assert.deepEqual(await ledger(db), ["0001_ok.surql"]);
    const [info] = await db.query<[{ tables: Record<string, unknown> }]>("INFO FOR DB").collect();
    assert.deepEqual(Object.keys(info.tables).sort(), ["migration", "ok"], "nothing of 0002 or 0003 is left");
  });
});

test("openDb migrates an in-process database, in memory or in a folder that keeps its data", async () => {
  const path = mkdtempSync(join(tmpdir(), "api-surrealkv-"));
  const first = await openDb({ path });
  await first.upsertOrg("org_A");
  const s = await first.createSessionUnlessActive("org_A", {
    id: "8d0f5a3c-2b7e-4c1a-9f6d-1e2a3b4c5d6e", createdBy: "user_1", meetingUrl: "https://meet.google.com/abc-defg-hij", limits: { maxUsd: 5, maxMinutes: 60 },
  });
  await first.close();
  const again = await openDb({ path });
  try {
    assert.equal((await again.getSession("org_A", s.session.id))?.id, s.session.id, "the row survives a reopen");
  } finally {
    await again.close();
  }
});

test("connect checks a server's settings before dialing, and the errors carry codes, not values", async () => {
  await assert.rejects(connect({ url: "https://db.example.com", user: "u", pass: "p" }), (err) => errorCode(err) === "SURREAL_URL_INVALID");
  await assert.rejects(connect({ url: "wss://db.example.com", user: "u" }), (err: Error) =>
    errorCode(err) === "SURREAL_AUTH_MISSING" && !err.message.includes("db.example.com"));
});

test("a server that doesn't answer fails at startup with SURREAL_UNREACHABLE", async () => {
  // A closed port on this machine: no network, and nothing outside it is contacted.
  await assert.rejects(connect({ url: "ws://127.0.0.1:9", user: "u", pass: "p", connectTimeoutMs: 1_000 }),
    (err) => errorCode(err) === "SURREAL_UNREACHABLE");
});
