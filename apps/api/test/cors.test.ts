// CORS for the web app (A1 in docs/plans/web-first-slice.md): exact allowed origins from CLERK_AUTHORIZED_PARTIES, on
// every reply including errors; preflight without auth; never a wildcard or credentials; off when Clerk is off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.ts";
import type { Authenticator } from "../src/auth/clerk.ts";
import { testConfig, withServer } from "./helpers/server.ts";

const WEB = "http://localhost:5173";
const DEPLOYED = "https://web.example.test";
const clerk = { jwtKey: "unused", authorizedParties: [WEB, DEPLOYED] };

// A signed-in member of org_a; no token is ever checked here.
const auth: Authenticator = {
  async authenticate() {
    return { userId: "user_1", sessionId: "sess_1", orgId: "org_a", orgRole: "org:admin" };
  },
};

function run(config = testConfig({ clerk }), fn: (base: string) => Promise<void>) {
  return withServer(createServer({ config, auth, log: () => {} }), fn);
}

const corsHeaders = (res: Response) => ({
  origin: res.headers.get("access-control-allow-origin"),
  vary: res.headers.get("vary"),
  credentials: res.headers.get("access-control-allow-credentials"),
});

test("an allowed origin may read a success and an error, with Vary: Origin and no credentials", async () => {
  await run(undefined, async (base) => {
    for (const [path, status] of [["/v1/me", 200], ["/v1/nope", 404], ["/health", 200]] as const) {
      const res = await fetch(base + path, { headers: { Origin: WEB } });
      assert.equal(res.status, status, path);
      assert.deepEqual(corsHeaders(res), { origin: WEB, vary: "Origin", credentials: null }, path);
    }
    const deployed = await fetch(`${base}/v1/me`, { headers: { Origin: DEPLOYED } });
    assert.equal(corsHeaders(deployed).origin, DEPLOYED);
  });
});

test("a 405 and a 500 carry it too", async () => {
  await run(undefined, async (base) => {
    const res = await fetch(`${base}/v1/me`, { method: "DELETE", headers: { Origin: WEB } });
    assert.equal(res.status, 405);
    assert.equal(corsHeaders(res).origin, WEB);
  });
  const failing: Authenticator = { authenticate: async () => { throw new Error("boom"); } };
  await withServer(createServer({ config: testConfig({ clerk }), auth: failing, log: () => {} }), async (base) => {
    const res = await fetch(`${base}/v1/me`, { headers: { Origin: WEB } });
    assert.equal(res.status, 500);
    assert.equal(corsHeaders(res).origin, WEB);
  });
});

test("any other origin, a near miss or no origin gets no CORS headers, but still Vary: Origin", async () => {
  await run(undefined, async (base) => {
    for (const origin of ["https://evil.example", "http://localhost:5174", `${WEB}/`, "HTTP://LOCALHOST:5173", "null", undefined]) {
      const res = await fetch(`${base}/v1/me`, origin ? { headers: { Origin: origin } } : {});
      // Vary on every reply, so a cache never hands an allowed origin's reply to another, or the other way round.
      assert.deepEqual(corsHeaders(res), { origin: null, vary: "Origin", credentials: null }, String(origin));
    }
  });
});

test("a preflight on /v1 answers 204 with the methods and headers the web app uses, without auth", async () => {
  const neverAuth: Authenticator = { authenticate: async () => { throw new Error("a preflight must not authenticate"); } };
  await withServer(createServer({ config: testConfig({ clerk }), auth: neverAuth, log: () => {} }), async (base) => {
    for (const path of ["/v1/sessions", "/v1/sessions/abc", "/v1/anything"]) {
      const res = await fetch(base + path, {
        method: "OPTIONS",
        headers: { Origin: WEB, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" },
      });
      assert.equal(res.status, 204, path);
      assert.equal(res.headers.get("access-control-allow-origin"), WEB);
      assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST");
      assert.equal(res.headers.get("access-control-allow-headers"), "Authorization, Content-Type");
      assert.equal(res.headers.get("access-control-max-age"), "600");
      assert.equal(res.headers.get("access-control-allow-credentials"), null);
      assert.equal(await res.text(), "");
    }
    const stranger = await fetch(`${base}/v1/sessions`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    assert.equal(stranger.status, 204);
    assert.equal(stranger.headers.get("access-control-allow-origin"), null);
    assert.equal(stranger.headers.get("vary"), "Origin");
  });
});

test("OPTIONS outside /v1 is still a 405, as before", async () => {
  await run(undefined, async (base) => {
    const res = await fetch(`${base}/health`, { method: "OPTIONS", headers: { Origin: WEB } });
    assert.equal(res.status, 405);
  });
});

test("with Clerk off, CORS is off", async () => {
  await run(testConfig({ clerk: null }), async (base) => {
    const res = await fetch(`${base}/health`, { headers: { Origin: WEB } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});
