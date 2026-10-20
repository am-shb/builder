import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { ConfigError, loadConfig, surrealSettings } from "../src/config.ts";

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
  assert.deepEqual(loadConfig({}), {
    port: 3001, clerk: null, engine: null, defaultLimits: null,
    startGuards: { maxActivePerOrg: 2, maxStartsPerOrgPerDay: 20, maxActivePerUser: 2, maxStartsPerUserPerDay: 20, startsPerUserPerMinute: 5, activeMarginMinutes: 30 },
    surreal: { url: null, user: null, pass: null, auth: "database", path: "data/surreal" },
  });
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

test("a bare host:port, as Render's fromService hostport gives it, means http", () => {
  assert.deepEqual(loadConfig({ ENGINE_INTERNAL_URL: "builder-engine:10000", ENGINE_INTERNAL_TOKEN: token }).engine,
    { url: "http://builder-engine:10000", token });
  rejects({ ENGINE_INTERNAL_URL: "builder-engine", ENGINE_INTERNAL_TOKEN: token }, /ENGINE_INTERNAL_URL/);
  rejects({ ENGINE_INTERNAL_URL: "builder-engine:10000/internal", ENGINE_INTERNAL_TOKEN: token }, /ENGINE_INTERNAL_URL/);
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

test("without SURREAL_URL the api runs SurrealDB in its own process, in data/surreal", () => {
  assert.deepEqual(surrealSettings({}), { url: null, user: null, pass: null, auth: "database", path: "data/surreal" });
  assert.equal(surrealSettings({ SURREAL_PATH: " /tmp/x " }).path, "/tmp/x");
});

test("with SURREAL_URL it signs in as a database user unless SURREAL_AUTH says root", () => {
  const cloud = { SURREAL_URL: "wss://abc123.aws-use1.surreal.cloud", SURREAL_USER: "api", SURREAL_PASS: "secret" };
  assert.deepEqual(loadConfig(cloud).surreal, { url: cloud.SURREAL_URL, user: "api", pass: "secret", auth: "database", path: "data/surreal" });
  assert.equal(surrealSettings({ ...cloud, SURREAL_URL: "ws://127.0.0.1:8000", SURREAL_AUTH: "root" }).auth, "root");
  assert.throws(() => surrealSettings({ ...cloud, SURREAL_AUTH: "namespace" }), /SURREAL_AUTH must be database, root, or empty/);
});

test("a SurrealDB server needs a ws:// or wss:// URL and both credentials, and errors never quote them", () => {
  for (const url of ["https://x.example.com", "not a url"]) {
    assert.throws(() => surrealSettings({ SURREAL_URL: url, SURREAL_USER: "u", SURREAL_PASS: "p" }),
      (err: Error) => err instanceof ConfigError && /ws:\/\/ or wss:\/\//.test(err.message) && !err.message.includes("example"));
  }
  for (const env of [{ SURREAL_USER: "u" }, { SURREAL_PASS: "hunter2" }, {}]) {
    assert.throws(() => surrealSettings({ SURREAL_URL: "wss://x.example.com", ...env }), (err: Error) =>
      /SURREAL_USER and SURREAL_PASS are required/.test(err.message) && !err.message.includes("hunter2"));
  }
});

test("production refuses to run without a SurrealDB server", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /SURREAL_URL is required when NODE_ENV=production/);
  const cloud = { NODE_ENV: "production", SURREAL_URL: "wss://x.example.com", SURREAL_USER: "api", SURREAL_PASS: "p" };
  assert.equal(loadConfig(cloud).surreal.url, cloud.SURREAL_URL);
  assert.equal(loadConfig({ NODE_ENV: "development" }).surreal.url, null);
});

test("the start guards default to safe values and can each be set; bad values are refused by name", () => {
  assert.deepEqual(loadConfig({
    MAX_ACTIVE_SESSIONS_PER_ORG: "1", MAX_STARTS_PER_ORG_PER_DAY: "5", MAX_ACTIVE_SESSIONS_PER_USER: "2", MAX_STARTS_PER_USER_PER_DAY: "7",
    START_RATE_LIMIT_PER_MINUTE: "3", ACTIVE_MARGIN_MINUTES: "0",
  }).startGuards, { maxActivePerOrg: 1, maxStartsPerOrgPerDay: 5, maxActivePerUser: 2, maxStartsPerUserPerDay: 7, startsPerUserPerMinute: 3, activeMarginMinutes: 0 });
  assert.equal(loadConfig({ MAX_ACTIVE_SESSIONS_PER_ORG: " " }).startGuards.maxActivePerOrg, 2, "blank is unset");
  for (const name of ["MAX_ACTIVE_SESSIONS_PER_ORG", "MAX_STARTS_PER_ORG_PER_DAY", "MAX_ACTIVE_SESSIONS_PER_USER", "MAX_STARTS_PER_USER_PER_DAY", "START_RATE_LIMIT_PER_MINUTE"]) {
    for (const bad of ["0", "-1", "2.5", "lots", "Infinity"]) rejects({ [name]: bad }, new RegExp(name));
  }
  for (const bad of ["-1", "1.5", "soon"]) rejects({ ACTIVE_MARGIN_MINUTES: bad }, /ACTIVE_MARGIN_MINUTES/);
});
