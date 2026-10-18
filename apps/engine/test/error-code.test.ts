import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCode } from "../src/error-code.ts";
import { connect } from "../src/db/connect.ts";
import { sql } from "drizzle-orm";

test("a Drizzle-wrapped error reports the code on its cause", () => {
  const err = Object.assign(new Error("Failed query: insert ... params: secret meeting text"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
  assert.equal(errorCode(err), "ECONNREFUSED");
});

test("errors without a code report the cause name, then their own name", () => {
  assert.equal(errorCode(new TypeError("x")), "TypeError");
  assert.equal(errorCode(Object.assign(new Error("x"), { cause: new RangeError("y") })), "RangeError");
  assert.equal(errorCode("nope"), "unknown");
  assert.equal(errorCode(null), "unknown");
});

test("a real failing query on PGlite reports the Postgres code", async () => {
  const { db, close } = await connect({});
  try {
    await db.execute(sql`select * from missing_table_xyz`).then(
      () => assert.fail("expected the query to fail"),
      (err) => {
        assert.equal(errorCode(err), "42P01");
        assert.ok(!errorCode(err).includes("missing_table_xyz"));
      },
    );
  } finally {
    await close();
  }
});
