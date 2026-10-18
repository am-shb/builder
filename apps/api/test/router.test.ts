import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHandler, createRouter } from "../src/router.ts";
import type { Route } from "../src/router.ts";
import { HttpError, readJson, sendJson } from "../src/http.ts";
import { withServer } from "./helpers/server.ts";

const noop = () => {};

test("match finds exact paths and :params, and ignores trailing slashes", () => {
  const router = createRouter([
    { method: "GET", path: "/v1/sessions", handler: noop },
    { method: "GET", path: "/v1/sessions/:id", handler: noop },
  ]);
  const list = router.match("GET", "/v1/sessions/");
  assert.equal(list.kind, "found");
  const one = router.match("GET", "/v1/sessions/abc%20def");
  assert.ok(one.kind === "found");
  assert.deepEqual(one.params, { id: "abc def" });
  assert.equal(router.match("GET", "/v1/sessions/a/b").kind, "not_found");
  assert.equal(router.match("GET", "/v1/sessions/%E0%A4%A").kind, "not_found");
});

test("match reports 405 with every method the path allows", () => {
  const router = createRouter([
    { method: "GET", path: "/v1/sessions", handler: noop },
    { method: "POST", path: "/v1/sessions", handler: noop },
  ]);
  assert.deepEqual(router.match("DELETE", "/v1/sessions"), { kind: "method_not_allowed", allow: ["GET", "POST"] });
});

// A tiny app over the real handler, to check the error mapping end to end.
function app(log: (msg: string, fields?: Record<string, unknown>) => void) {
  const routes: Route[] = [
    { method: "GET", path: "/teapot", handler: () => { throw new HttpError(418, "teapot", "I'm a teapot."); } },
    { method: "GET", path: "/boom", handler: () => { throw new Error("secret meeting words"); } },
    { method: "POST", path: "/echo", handler: async ({ req, res }) => sendJson(res, 200, { got: await readJson(req, 64) }) },
    { method: "GET", path: "/items/:id", handler: ({ res, params }) => sendJson(res, 200, params) },
  ];
  return createServer(createHandler(routes, log));
}

test("an HttpError answers with its own status and code", async () => {
  await withServer(app(noop), async (base) => {
    const res = await fetch(`${base}/teapot`);
    assert.equal(res.status, 418);
    assert.deepEqual(await res.json(), { error: { code: "teapot", message: "I'm a teapot." } });
  });
});

test("any other error answers 500 and logs the error name, never its message", async () => {
  const logged: unknown[] = [];
  await withServer(app((msg, fields) => logged.push({ msg, ...fields })), async (base) => {
    const res = await fetch(`${base}/boom`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error.code, "internal_error");
    assert.ok(!JSON.stringify(body).includes("secret"));
  });
  assert.deepEqual(logged, [{ msg: "http.error", route: "GET /boom", error: "Error" }]);
});

test("params reach the handler", async () => {
  await withServer(app(noop), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/items/42`)).json(), { id: "42" });
  });
});

test("readJson parses a JSON body", async () => {
  await withServer(app(noop), async (base) => {
    const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
    assert.deepEqual(await res.json(), { got: { a: 1 } });
  });
});

test("readJson refuses bad JSON, a non-JSON type and an oversized body", async () => {
  await withServer(app(noop), async (base) => {
    const post = (body: string, type = "application/json; charset=utf-8") =>
      fetch(`${base}/echo`, { method: "POST", headers: { "content-type": type }, body });
    const bad = await post("{nope");
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "invalid_json");
    const text = await post("{}", "text/plain");
    assert.equal(text.status, 415);
    assert.equal((await text.json()).error.code, "unsupported_media_type");
    const big = await post(JSON.stringify({ x: "y".repeat(100) }));
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error.code, "payload_too_large");
  });
});
