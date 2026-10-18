import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.ts";
import { parseEngineEvent } from "../src/contracts.ts";
import { testConfig, withServer } from "./helpers/server.ts";

const server = () => createServer({ config: testConfig(), log: () => {} });

test("GET /health answers 200 { ok: true }", async () => {
  await withServer(server(), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("unknown paths answer 404 with the error shape", async () => {
  await withServer(server(), async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, "not_found");
  });
});

test("a known path with another method answers 405 with Allow", async () => {
  await withServer(server(), async (base) => {
    const res = await fetch(`${base}/health`, { method: "POST" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
    assert.equal((await res.json()).error.code, "method_not_allowed");
  });
});

test("the contracts workspace link works", () => {
  assert.equal(parseEngineEvent({ type: "future.thing" }).kind, "unknown");
});
