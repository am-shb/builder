import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.ts";

// A publishable key is pk_test_ or pk_live_ plus the base64 of "<frontend api host>$".
const KEY = `pk_test_${Buffer.from("bright-fox-12.clerk.accounts.dev$").toString("base64")}`;

test("both settings read in their normal form", () => {
  const c = readConfig({ clerkPublishableKey: ` ${KEY} `, apiUrl: "https://api.example.test/" });
  assert.equal(c.clerkPublishableKey, KEY);
  assert.equal(c.apiUrl, "https://api.example.test");
});

test("a key that isn't a publishable key, or an api URL with a path, reads as not configured", () => {
  assert.equal(readConfig({ clerkPublishableKey: "sk_test_secret", apiUrl: "https://api.example.test" }).clerkPublishableKey, null);
  assert.equal(readConfig({ clerkPublishableKey: KEY, apiUrl: "https://api.example.test/v1" }).apiUrl, null);
  assert.equal(readConfig({ clerkPublishableKey: KEY, apiUrl: "api.example.test" }).apiUrl, null);
  assert.deepEqual(readConfig({}), { clerkPublishableKey: null, apiUrl: null });
});

test("a phone on the Wi-Fi may reach the api over plain http in development, never in a production build", () => {
  const lan = "http://192.168.1.20:3001";
  assert.equal(readConfig({ clerkPublishableKey: KEY, apiUrl: lan }).apiUrl, lan);
  assert.equal(readConfig({ clerkPublishableKey: KEY, apiUrl: lan, production: true }).apiUrl, null);
  assert.equal(readConfig({ clerkPublishableKey: KEY, apiUrl: "https://api.example.test", production: true }).apiUrl, "https://api.example.test");
});
