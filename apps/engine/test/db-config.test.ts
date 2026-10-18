// SURREAL_* settings (src/config.ts): which database the engine opens, and how it signs in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, surrealSettings } from "../src/config.ts";

const RECALL = {
  RECALL_REGION: "us-west-2", RECALL_API_KEY: "k", RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_x", PUBLIC_API_BASE_URL: "https://a.example.com",
};

test("without SURREAL_URL the engine runs SurrealDB in its own process, in data/surreal", () => {
  assert.deepEqual(loadConfig(RECALL).surreal, { url: null, user: null, pass: null, auth: "database", path: "data/surreal" });
  assert.equal(surrealSettings({ SURREAL_PATH: " /tmp/x " }).path, "/tmp/x");
});

test("with SURREAL_URL it signs in as a database user unless SURREAL_AUTH says root", () => {
  const cloud = { SURREAL_URL: "wss://abc123.aws-use1.surreal.cloud", SURREAL_USER: "engine", SURREAL_PASS: "secret" };
  assert.deepEqual(surrealSettings(cloud), { url: cloud.SURREAL_URL, user: "engine", pass: "secret", auth: "database", path: "data/surreal" });
  assert.equal(surrealSettings({ ...cloud, SURREAL_URL: "ws://127.0.0.1:8000", SURREAL_AUTH: "root" }).auth, "root");
  assert.throws(() => surrealSettings({ ...cloud, SURREAL_AUTH: "namespace" }), /SURREAL_AUTH must be database, root, or empty/);
});

test("a server needs a ws:// or wss:// URL and both credentials, and the error never quotes them", () => {
  assert.throws(() => surrealSettings({ SURREAL_URL: "https://x.example.com", SURREAL_USER: "u", SURREAL_PASS: "p" }), /ws:\/\/ or wss:\/\//);
  assert.throws(() => surrealSettings({ SURREAL_URL: "not a url", SURREAL_USER: "u", SURREAL_PASS: "p" }), /ws:\/\/ or wss:\/\//);
  for (const env of [{ SURREAL_USER: "u" }, { SURREAL_PASS: "hunter2" }, {}]) {
    assert.throws(() => surrealSettings({ SURREAL_URL: "wss://x.example.com", ...env }), (err: Error) =>
      /SURREAL_USER and SURREAL_PASS are required/.test(err.message) && !err.message.includes("hunter2"));
  }
});
