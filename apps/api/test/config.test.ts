import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { ConfigError, loadConfig } from "../src/config.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const token = "t".repeat(32);

// Every failure must name the variable but never echo the value it was given.
function rejects(env: Record<string, string>, variable: RegExp) {
  assert.throws(() => loadConfig(env), (err: unknown) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, variable);
    for (const v of Object.values(env)) if (v.length > 3) assert.ok(!err.message.includes(v), "error message leaks a value");
    return true;
  });
}

test("an empty environment gives defaults with every optional part off", () => {
  assert.deepEqual(loadConfig({}), { port: 3001, clerk: null, engine: null, defaultLimits: null });
});

test("blank values count as unset", () => {
  assert.deepEqual(loadConfig({ PORT: " ", CLERK_JWT_KEY: "", ENGINE_INTERNAL_URL: "  " }).engine, null);
});

test("PORT must be a whole number in range", () => {
  assert.equal(loadConfig({ PORT: "8080" }).port, 8080);
  for (const PORT of ["0", "70000", "3.5", "abc"]) rejects({ PORT }, /PORT/);
});

test("Clerk settings parse, including a one-line PEM with literal \\n", () => {
  const oneLine = pem.replace(/\n/g, "\\n");
  const c = loadConfig({ CLERK_JWT_KEY: oneLine, CLERK_AUTHORIZED_PARTIES: "http://localhost:5173, https://app.example.com" });
  assert.equal(c.clerk?.jwtKey, pem);
  assert.deepEqual(c.clerk?.authorizedParties, ["http://localhost:5173", "https://app.example.com"]);
});

test("Clerk settings must come together and be well formed", () => {
  rejects({ CLERK_JWT_KEY: pem }, /CLERK_AUTHORIZED_PARTIES/);
  rejects({ CLERK_AUTHORIZED_PARTIES: "https://app.example.com" }, /CLERK_JWT_KEY/);
  rejects({ CLERK_JWT_KEY: "not-a-pem-value", CLERK_AUTHORIZED_PARTIES: "https://a.test" }, /CLERK_JWT_KEY/);
  rejects({ CLERK_JWT_KEY: pem, CLERK_AUTHORIZED_PARTIES: "https://a.test/path" }, /CLERK_AUTHORIZED_PARTIES/);
  rejects({ CLERK_JWT_KEY: pem, CLERK_AUTHORIZED_PARTIES: "ftp://a.test" }, /CLERK_AUTHORIZED_PARTIES/);
});

test("engine settings parse, and a trailing slash is dropped", () => {
  const c = loadConfig({ ENGINE_INTERNAL_URL: "http://engine:10000/", ENGINE_INTERNAL_TOKEN: token });
  assert.deepEqual(c.engine, { url: "http://engine:10000", token });
});

test("engine settings must come together, with an origin and a long enough token", () => {
  rejects({ ENGINE_INTERNAL_URL: "http://engine:10000" }, /ENGINE_INTERNAL_TOKEN/);
  rejects({ ENGINE_INTERNAL_TOKEN: token }, /ENGINE_INTERNAL_URL/);
  rejects({ ENGINE_INTERNAL_URL: "http://engine:10000/internal", ENGINE_INTERNAL_TOKEN: token }, /ENGINE_INTERNAL_URL/);
  rejects({ ENGINE_INTERNAL_URL: "http://engine:10000", ENGINE_INTERNAL_TOKEN: "short-secret" }, /ENGINE_INTERNAL_TOKEN/);
});

test("default limits parse, must come together and be above 0", () => {
  assert.deepEqual(loadConfig({ DEFAULT_MAX_USD: "5", DEFAULT_MAX_MINUTES: "60" }).defaultLimits, { maxUsd: 5, maxMinutes: 60 });
  rejects({ DEFAULT_MAX_USD: "5" }, /DEFAULT_MAX_MINUTES/);
  rejects({ DEFAULT_MAX_USD: "0", DEFAULT_MAX_MINUTES: "60" }, /DEFAULT_MAX_USD/);
  rejects({ DEFAULT_MAX_USD: "5", DEFAULT_MAX_MINUTES: "lots" }, /DEFAULT_MAX_MINUTES/);
});
