import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.ts";
import { parseEngineEvent } from "../src/contracts.ts";

async function withServer(fn: (base: string) => Promise<void>) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /health answers 200 { ok: true }", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("unknown paths answer 404", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

test("the contracts workspace link works", () => {
  assert.equal(parseEngineEvent({ type: "future.thing" }).kind, "unknown");
});
