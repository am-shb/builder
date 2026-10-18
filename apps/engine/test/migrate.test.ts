// The SurrealQL migration runner (src/db/migrate.ts), on the in-process engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../src/db/connect.ts";
import { migrate, MIGRATIONS_DIR } from "../src/db/migrate.ts";
import { errorCode } from "../src/error-code.ts";

const dirWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "engine-migrations-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

async function withDb(fn: (db: Awaited<ReturnType<typeof connect>>) => Promise<void>) {
  const db = await connect();
  try {
    await fn(db);
  } finally {
    await db.close();
  }
}

const ledger = async (db: Awaited<ReturnType<typeof connect>>) =>
  (await db.query<[{ name: string; at: unknown }[]]>("SELECT record::id(id) AS name, applied_at AS at FROM migration ORDER BY name").collect())[0];

test("the engine's own migrations apply to a new database, and a second run is a no-op", async () => {
  await withDb(async (db) => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".surql")).sort();
    assert.ok(files.includes("0001_init.surql"));
    assert.deepEqual(await migrate(db), files);
    assert.deepEqual(await migrate(db), []);
    const rows = await ledger(db);
    assert.deepEqual(rows.map((r) => r.name), files, "each file is recorded once");
    assert.ok(rows.every((r) => r.at && typeof (r.at as { toDate?: unknown }).toDate === "function"), "with the time it was applied");
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
    await db.query("CREATE t:1 SET a = 'x', b = 'y', c = 'z'").collect();
  });
});

test("a failing file applies nothing and stops the run; the files before it stay applied", async () => {
  const dir = dirWith({
    "0001_ok.surql": "DEFINE TABLE ok SCHEMAFULL;",
    // The table is defined, then a statement fails: the transaction takes the table back out.
    "0002_bad.surql": "DEFINE TABLE half SCHEMAFULL; DEFINE FIELD x ON half TYPE string; CREATE half:1 SET x = 1;",
    "0003_after.surql": "DEFINE TABLE after SCHEMAFULL;",
  });
  await withDb(async (db) => {
    await assert.rejects(migrate(db, dir), (err) => errorCode(err) === "Internal");
    assert.deepEqual((await ledger(db)).map((r) => r.name), ["0001_ok.surql"]);
    const [info] = await db.query<[{ tables: Record<string, unknown> }]>("INFO FOR DB").collect();
    assert.deepEqual(Object.keys(info.tables).sort(), ["migration", "ok"], "nothing of 0002 or 0003 is left");

    writeFileSync(join(dir, "0002_bad.surql"), "DEFINE TABLE half SCHEMAFULL; DEFINE FIELD x ON half TYPE string;");
    assert.deepEqual(await migrate(db, dir), ["0002_bad.surql", "0003_after.surql"]);
  });
});

test("two runs at once apply each file once", async () => {
  const dir = dirWith({ "0001_a.surql": "DEFINE TABLE a SCHEMAFULL;", "0002_b.surql": "DEFINE TABLE b SCHEMAFULL;" });
  await withDb(async (db) => {
    const results = await Promise.allSettled([migrate(db, dir), migrate(db, dir)]);
    assert.ok(results.some((r) => r.status === "fulfilled"), "one of them gets through");
    assert.deepEqual(await migrate(db, dir), [], "whatever the loser left undone, a rerun finds nothing to do");
    assert.deepEqual((await ledger(db)).map((r) => r.name), ["0001_a.surql", "0002_b.surql"]);
  });
});
