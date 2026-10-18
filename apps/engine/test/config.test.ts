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

test("names PUBLIC_API_BASE_URL as missing when neither is set", () => {
  assert.throws(() => loadConfig({ ...BASE }), /PUBLIC_API_BASE_URL/);
});
