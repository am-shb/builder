import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { bearerToken, callerFromClaims, createClerkAuth } from "../src/auth/clerk.ts";
import { ORG_ADMIN, ORG_MEMBER, requireOrg, requireOrgRole } from "../src/auth/org.ts";
import { HttpError } from "../src/http.ts";
import { createServer } from "../src/server.ts";
import { otherPrivateKey, signJwt, signToken, testClerk } from "./helpers/clerk.ts";
import { testConfig, withServer } from "./helpers/server.ts";

// No test may reach Clerk, or anything else: any fetch from the code under test fails the test that made it.
// The test client's own requests to the local server are let through.
const realFetch = globalThis.fetch;
const outbound: string[] = [];
before(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
    outbound.push(url);
    return Promise.reject(new Error("network disabled in tests"));
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(outbound, [], "code under test made a network call");
});

const req = (authorization?: string) => ({ headers: authorization === undefined ? {} : { authorization } }) as IncomingMessage;

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, log: (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, ...fields }) };
}

async function rejectsWith(p: Promise<unknown>, status: number, code: string) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

// ---- bearerToken and claims ----

test("bearerToken reads a Bearer header, case-insensitively, and nothing else", () => {
  assert.equal(bearerToken(req("Bearer abc.def.ghi")), "abc.def.ghi");
  assert.equal(bearerToken(req("bearer abc")), "abc");
  assert.equal(bearerToken(req()), null);
  assert.equal(bearerToken(req("Basic dXNlcjpwYXNz")), null);
  assert.equal(bearerToken(req("Bearer")), null);
  assert.equal(bearerToken(req("Bearer a b")), null);
});

test("callerFromClaims reads v2 `o` and v1 org claims, as Clerk's SDK does", () => {
  assert.deepEqual(callerFromClaims({ v: 2, sub: "user_1", sid: "sess_1", o: { id: "org_1", rol: "admin" } }),
    { userId: "user_1", sessionId: "sess_1", orgId: "org_1", orgRole: "org:admin" });
  assert.deepEqual(callerFromClaims({ sub: "user_1", org_id: "org_1", org_role: "org:member" }),
    { userId: "user_1", sessionId: null, orgId: "org_1", orgRole: "org:member" });
  assert.deepEqual(callerFromClaims({ v: 2, sub: "user_1" }), { userId: "user_1", sessionId: null, orgId: null, orgRole: null });
  assert.equal(callerFromClaims({ v: 2, o: { id: "org_1", rol: "admin" } }), null);
  // A role with no org is no role at all.
  assert.equal(callerFromClaims({ sub: "user_1", org_role: "org:admin" })?.orgRole, null);
});

// ---- authenticate, with the real verifyToken and test-time keys ----

test("a valid token gives the caller and org", async () => {
  const auth = createClerkAuth(testClerk, { log: () => {} });
  const caller = await auth.authenticate(req(`Bearer ${signToken({ rol: "admin" })}`));
  assert.deepEqual(caller, { userId: "user_test_1", sessionId: "sess_test_1", orgId: "org_test_a", orgRole: ORG_ADMIN });
});

test("a valid token with no active org authenticates, with a null org", async () => {
  const auth = createClerkAuth(testClerk, { log: () => {} });
  const caller = await auth.authenticate(req(`Bearer ${signToken({ orgId: null })}`));
  assert.equal(caller.orgId, null);
  assert.equal(caller.orgRole, null);
});

test("bad tokens are refused with 401, and the log carries a reason code but never the token", async () => {
  const { lines, log } = capture();
  const auth = createClerkAuth(testClerk, { log });
  const now = Math.floor(Date.now() / 1000);
  const cases: Record<string, string> = {
    expired: signToken({ expiresIn: -60 }),
    "not yet valid": signToken({ notBeforeIn: 120 }),
    "signed by another key": signToken({ key: otherPrivateKey }),
    "minted for another site": signToken({ azp: "https://evil.example" }),
    "no azp": signToken({ azp: null }),
    "pending session": signToken({ sts: "pending" }),
    "alg none": signJwt({ alg: "none", typ: "JWT" }, { sub: "user_x", exp: now + 60, azp: "http://localhost:5173" }),
    "alg HS256": signJwt({ alg: "HS256", typ: "JWT" }, { sub: "user_x", exp: now + 60, azp: "http://localhost:5173" }),
    // Clerk's SDK refuses a missing `sub`; an empty one gets past it, and our own check refuses it.
    "no subject": signJwt({ alg: "RS256", typ: "JWT", kid: "ins_test" }, { v: 2, exp: now + 60, azp: "http://localhost:5173" }),
    "empty subject": signToken({ userId: "" }),
    junk: "not-a-jwt",
  };
  // A token whose payload was edited after signing: the signature no longer matches.
  const [h, , s] = signToken().split(".");
  cases["edited payload"] = `${h}.${Buffer.from(JSON.stringify({ v: 2, sub: "user_x", exp: now + 60, azp: "http://localhost:5173", o: { id: "org_victim", rol: "admin" } })).toString("base64url")}.${s}`;

  for (const [name, token] of Object.entries(cases)) {
    await rejectsWith(auth.authenticate(req(`Bearer ${token}`)), 401, "unauthenticated").catch((err) => {
      throw new Error(`case "${name}": ${(err as Error).message}`);
    });
  }
  assert.equal(lines.length, Object.keys(cases).length);
  for (const line of lines) {
    assert.equal(line.msg, "auth.rejected");
    assert.equal(typeof line.reason, "string");
    assert.deepEqual(Object.keys(line).sort(), ["msg", "reason"]);
  }
  const reasons = lines.map((l) => l.reason);
  assert.ok(reasons.includes("token-expired"), `reasons: ${reasons.join(", ")}`);
  assert.ok(reasons.includes("token-invalid-authorized-parties"), `reasons: ${reasons.join(", ")}`);
  assert.ok(reasons.includes("session-pending"));
  assert.ok(reasons.includes("no-subject"));
});

test("a missing or non-Bearer header is 401 without calling the verifier", async () => {
  let called = 0;
  const auth = createClerkAuth(testClerk, { log: () => {}, verify: async () => { called++; return {} as never; } });
  await rejectsWith(auth.authenticate(req()), 401, "unauthenticated");
  await rejectsWith(auth.authenticate(req("Basic dXNlcjpwYXNz")), 401, "unauthenticated");
  assert.equal(called, 0);
});

test("a verifier that throws is 401 and logs the error name only", async () => {
  const { lines, log } = capture();
  const auth = createClerkAuth(testClerk, { log, verify: async () => { throw new TypeError("claims: secret stuff"); } });
  await rejectsWith(auth.authenticate(req("Bearer x.y.z")), 401, "unauthenticated");
  assert.deepEqual(lines, [{ msg: "auth.rejected", reason: "TypeError" }]);
});

test("with Clerk not configured, authenticate answers 503 auth_unavailable", async () => {
  const auth = createClerkAuth(null, { log: () => {} });
  await rejectsWith(auth.authenticate(req(`Bearer ${signToken()}`)), 503, "auth_unavailable");
});

// ---- requireOrg and requireOrgRole ----

test("requireOrg needs an active org", () => {
  assert.deepEqual(requireOrg({ userId: "u", sessionId: null, orgId: "o", orgRole: ORG_MEMBER }), { userId: "u", orgId: "o", role: ORG_MEMBER });
  assert.throws(() => requireOrg({ userId: "u", sessionId: null, orgId: null, orgRole: null }),
    (e: unknown) => e instanceof HttpError && e.status === 403 && e.code === "no_active_org");
});

test("requireOrgRole allows listed roles and refuses others with 403 forbidden", () => {
  const member = { userId: "u", orgId: "o", role: ORG_MEMBER };
  assert.equal(requireOrgRole(member, [ORG_ADMIN, ORG_MEMBER]), member);
  assert.throws(() => requireOrgRole(member, [ORG_ADMIN]), (e: unknown) => e instanceof HttpError && e.status === 403 && e.code === "forbidden");
});

// ---- GET /v1/me over HTTP ----

const server = (clerk = testClerk) => createServer({ config: testConfig({ clerk }), log: () => {} });
const me = (base: string, token?: string) => fetch(`${base}/v1/me`, token ? { headers: { authorization: `Bearer ${token}` } } : {});

test("GET /v1/me returns the user, org and role from the token", async () => {
  await withServer(server(), async (base) => {
    const admin = await me(base, signToken({ userId: "user_a", orgId: "org_a", rol: "admin" }));
    assert.equal(admin.status, 200);
    assert.deepEqual(await admin.json(), { userId: "user_a", orgId: "org_a", role: "org:admin" });
    const member = await me(base, signToken({ orgId: "org_b", rol: "member" }));
    assert.equal((await member.json()).role, "org:member");
  });
});

test("GET /v1/me ignores an org given in the query: the org comes from the token only", async () => {
  await withServer(server(), async (base) => {
    const res = await fetch(`${base}/v1/me?orgId=org_victim`, { headers: { authorization: `Bearer ${signToken({ orgId: "org_a" })}` } });
    assert.equal((await res.json()).orgId, "org_a");
  });
});

test("GET /v1/me answers 401, 403 and 503 with the error shape", async () => {
  await withServer(server(), async (base) => {
    const none = await me(base);
    assert.equal(none.status, 401);
    assert.equal((await none.json()).error.code, "unauthenticated");
    const expired = await me(base, signToken({ expiresIn: -60 }));
    assert.equal(expired.status, 401);
    const noOrg = await me(base, signToken({ orgId: null }));
    assert.equal(noOrg.status, 403);
    assert.equal((await noOrg.json()).error.code, "no_active_org");
  });
  await withServer(createServer({ config: testConfig(), log: () => {} }), async (base) => {
    const res = await me(base, signToken());
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "auth_unavailable");
  });
});
