// PUBLIC_API_BASE_URL and its fallback to RENDER_EXTERNAL_URL, which Render sets on web services (ADR 0005).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

const BASE = {
  RECALL_REGION: "us-west-2",
  RECALL_API_KEY: "k",
  RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("test").toString("base64"),
};

test("PUBLIC_API_BASE_URL wins when set", () => {
  const c = loadConfig({ ...BASE, PUBLIC_API_BASE_URL: "https://a.example.com/", RENDER_EXTERNAL_URL: "https://b.onrender.com" });
  assert.equal(c.publicBaseUrl, "https://a.example.com");
});

test("falls back to RENDER_EXTERNAL_URL when PUBLIC_API_BASE_URL is empty or missing", () => {
  assert.equal(loadConfig({ ...BASE, RENDER_EXTERNAL_URL: "https://b.onrender.com" }).publicBaseUrl, "https://b.onrender.com");
  assert.equal(
    loadConfig({ ...BASE, PUBLIC_API_BASE_URL: "  ", RENDER_EXTERNAL_URL: "https://b.onrender.com" }).publicBaseUrl,
    "https://b.onrender.com",
  );
});

test("the fallback is checked like PUBLIC_API_BASE_URL", () => {
  assert.throws(() => loadConfig({ ...BASE, RENDER_EXTERNAL_URL: "http://b.onrender.com" }), /must be https/);
});

test("names PUBLIC_API_BASE_URL as missing when neither is set", () => {
  assert.throws(() => loadConfig({ ...BASE }), /Missing required environment variables: PUBLIC_API_BASE_URL$/);
  assert.throws(() => loadConfig({}), /RECALL_REGION, RECALL_API_KEY, RECALL_WEBHOOK_VERIFICATION_SECRET, PUBLIC_API_BASE_URL/);
});
