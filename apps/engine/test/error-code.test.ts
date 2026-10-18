import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { errorCode } from "../src/error-code.ts";
import { connect } from "../src/db/connect.ts";
import { testStore } from "./helpers/store.ts";

test("a string code wins, on the error or on its cause", () => {
  const err = Object.assign(new Error("Failed query: insert ... params: secret meeting text"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
  assert.equal(errorCode(err), "ECONNREFUSED");
  assert.equal(errorCode(Object.assign(new Error("x"), { code: "SURREAL_UNREACHABLE" })), "SURREAL_UNREACHABLE");
});

test("errors without a code report the cause name, then their own name", () => {
  assert.equal(errorCode(new TypeError("x")), "TypeError");
  assert.equal(errorCode(Object.assign(new Error("x"), { cause: new RangeError("y") })), "RangeError");
  assert.equal(errorCode("nope"), "unknown");
  assert.equal(errorCode(null), "unknown");
});

test("a real SurrealDB error from the in-process engine reports its kind and detail kind, not the names in it", async () => {
  const db = await connect();
  try {
    await db.query("SELECT * FROM missing_table_xyz").collect().then(
      () => assert.fail("expected the query to fail"),
      (err) => {
        assert.equal(errorCode(err), "NotFound.Table");
        assert.ok(!JSON.stringify(errorCode(err)).includes("missing_table_xyz"));
      },
    );
    await db.query("SELEC oops").collect().then(() => assert.fail("expected a parse error"), (err) => assert.equal(errorCode(err), "Validation"));
  } finally {
    await db.close();
  }
});

test("a store error that quotes a value is logged without it", async () => {
  const store = await testStore();
  await store.createIntent("a", "https://meet.google.com/a");
  await store.createIntent("b", "https://meet.google.com/b");
  await store.markCreated("a", "bot-secret-value");
  const err = await store.markCreated("b", "bot-secret-value").then(() => assert.fail("expected a duplicate bot id to fail"), (e: unknown) => e);
  assert.match(String((err as Error).message), /bot-secret-value/, "the message quotes the value, which is why it is never logged");
  assert.equal(errorCode(err), "Internal");
});

test("a server that can't be reached fails at startup with SURREAL_UNREACHABLE", async () => {
  // A port that was free a moment ago: nothing listens there.
  const port = await new Promise<number>((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
  await assert.rejects(
    connect({ url: `ws://127.0.0.1:${port}`, user: "u", pass: "p", connectTimeoutMs: 300 }),
    (err) => errorCode(err) === "SURREAL_UNREACHABLE",
  );
  await assert.rejects(connect({ url: "postgres://x", user: "u", pass: "p" }), (err) => errorCode(err) === "SURREAL_URL_INVALID");
  await assert.rejects(connect({ url: "wss://x.example.com" }), (err) => errorCode(err) === "SURREAL_AUTH_MISSING");
});
