// GET /v1/sessions and GET /v1/sessions/:id over HTTP, with test-signed Clerk tokens and in-memory SurrealDB.
// Nothing here calls Clerk, SurrealDB Cloud or the engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "../src/server.ts";
import type { Db, NewSession } from "../src/db/index.ts";
import { SessionList, SessionResponse } from "../src/routes/schemas.ts";
import { signToken, testClerk } from "./helpers/clerk.ts";
import type { ClerkConfig } from "../src/config.ts";
import { testConfig, withServer } from "./helpers/server.ts";
import { testDb } from "./helpers/db.ts";

const MEET = "https://meet.google.com/abc-defg-hij";
const limits = { maxUsd: 5, maxMinutes: 60 };
const newSession = (over: Partial<NewSession> = {}): NewSession => ({ id: randomUUID(), createdBy: "user_1", meetingUrl: MEET, limits, ...over });

type Logged = { msg: string; fields?: Record<string, unknown> };

async function withApi(db: Db | null, fn: (base: string, logs: Logged[]) => Promise<void>, clerk: ClerkConfig | null = testClerk) {
  const logs: Logged[] = [];
  const server = createServer({ config: testConfig({ clerk }), db, log: (msg, fields) => logs.push({ msg, fields }) });
  await withServer(server, (base) => fn(base, logs));
}

const get = (base: string, path: string, token?: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

const tokenFor = (orgId: string, rol = "member") => signToken({ userId: `user_${orgId}`, orgId, rol });

/** Two orgs with sessions of their own: org_a has two (one started), org_b has one. */
async function seeded() {
  const db = await testDb();
  const a1 = (await db.createSessionUnlessActive("org_a", newSession({ meetingUrl: `${MEET}?a1` }))).session;
  const a2 = (await db.createSessionUnlessActive("org_a", newSession({ meetingUrl: `${MEET}?a2` }))).session;
  await db.setSessionStart("org_a", a2.id, { kind: "ok", status: "joining", stageUrl: "https://stage.example.com/a2" });
  const b1 = (await db.createSessionUnlessActive("org_b", newSession({ meetingUrl: `${MEET}?b1` }))).session;
  await db.setSessionStart("org_b", b1.id, { kind: "rejected", errorCode: "recall_rejected" });
  return { db, a1, a2, b1 };
}

test("GET /v1/sessions lists the caller's org's sessions, newest first, in the SessionList shape", async () => {
  const { db, a1, a2 } = await seeded();
  await withApi(db, async (base) => {
    const res = await get(base, "/v1/sessions", tokenFor("org_a"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = SessionList.parse(await res.json());
    assert.deepEqual(body.sessions.map((s) => s.id), [a2.id, a1.id]);
    const [started, starting] = body.sessions;
    assert.equal(started.status, "joining");
    assert.equal(started.stageUrl, "https://stage.example.com/a2", "the stage URL is shown to the owning org (D8)");
    assert.equal(starting.status, "starting");
    assert.equal("stageUrl" in starting || "errorCode" in starting, false, "absent, not null, when there's nothing to say");
    assert.deepEqual(starting.limits, limits);
  });
});

test("tenant isolation: one org never sees another org's sessions, whatever it asks for", async () => {
  const { db, a1, a2, b1 } = await seeded();
  await withApi(db, async (base) => {
    const asB = tokenFor("org_b");
    // The list holds only org_b's own session, even when the request names org_a.
    for (const path of ["/v1/sessions", "/v1/sessions?orgId=org_a", "/v1/sessions?org=org_a&org_id=org_a"]) {
      const body = SessionList.parse(await (await get(base, path, asB, { "x-org-id": "org_a", "x-clerk-org-id": "org_a" })).json());
      assert.deepEqual(body.sessions.map((s) => s.id), [b1.id], path);
    }
    // org_a's ids answer exactly like an id that doesn't exist.
    const missing = await get(base, `/v1/sessions/${randomUUID()}`, asB);
    const missingBody = await missing.json();
    assert.equal(missing.status, 404);
    for (const id of [a1.id, a2.id]) {
      const res = await get(base, `/v1/sessions/${id}?orgId=org_a`, asB, { "x-org-id": "org_a" });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), missingBody);
    }
    // And the other way round.
    assert.equal((await get(base, `/v1/sessions/${b1.id}`, tokenFor("org_a"))).status, 404);
    const listA = SessionList.parse(await (await get(base, "/v1/sessions", tokenFor("org_a"))).json());
    assert.ok(!listA.sessions.some((s) => s.id === b1.id));
    // An org with no sessions sees an empty list, not anyone else's.
    assert.deepEqual(await (await get(base, "/v1/sessions", tokenFor("org_c"))).json(), { sessions: [] });
  });
});

test("GET /v1/sessions/:id returns the org's session in the SessionResponse shape", async () => {
  const { db, a2, b1 } = await seeded();
  await withApi(db, async (base) => {
    const res = await get(base, `/v1/sessions/${a2.id}`, tokenFor("org_a"));
    assert.equal(res.status, 200);
    const { session } = SessionResponse.parse(await res.json());
    assert.deepEqual([session.id, session.status, session.meetingUrl], [a2.id, "joining", `${MEET}?a2`]);
    const failed = SessionResponse.parse(await (await get(base, `/v1/sessions/${b1.id}`, tokenFor("org_b"))).json()).session;
    assert.deepEqual([failed.status, failed.errorCode, failed.stageUrl], ["start_failed", "recall_rejected", undefined]);
  });
});

test("an id that isn't a session id is a 404 with the error shape", async () => {
  const { db } = await seeded();
  await withApi(db, async (base) => {
    for (const id of ["nope", "org_a", "123", encodeURIComponent("x' OR 1=1"), "%E0%A4%A"]) {
      const res = await get(base, `/v1/sessions/${id}`, tokenFor("org_a"));
      assert.equal(res.status, 404, id);
      assert.equal((await res.json()).error.code, "not_found");
    }
  });
});

test("both admins and members may read", async () => {
  const { db, a1 } = await seeded();
  await withApi(db, async (base) => {
    for (const rol of ["admin", "member"]) {
      assert.equal((await get(base, "/v1/sessions", tokenFor("org_a", rol))).status, 200, rol);
      assert.equal((await get(base, `/v1/sessions/${a1.id}`, tokenFor("org_a", rol))).status, 200, rol);
    }
  });
});

test("the list holds the org's 50 newest", async () => {
  const db = await testDb();
  const ids: string[] = [];
  for (let i = 0; i < 52; i++) ids.push((await db.createSessionUnlessActive("org_a", newSession({ meetingUrl: `${MEET}?n=${i}` }))).session.id);
  await withApi(db, async (base) => {
    const body = SessionList.parse(await (await get(base, "/v1/sessions?limit=500", tokenFor("org_a"))).json());
    assert.deepEqual(body.sessions.map((s) => s.id), ids.slice(-50).reverse());
  });
});

test("401 without a valid token, 403 without an active org, before the database is touched", async () => {
  const { db, a1 } = await seeded();
  await withApi(db, async (base) => {
    for (const path of ["/v1/sessions", `/v1/sessions/${a1.id}`]) {
      for (const token of [undefined, "junk", signToken({ orgId: "org_a", expiresIn: -60 })]) {
        const res = await get(base, path, token);
        assert.equal(res.status, 401, `${path} ${token ? "bad" : "no"} token`);
        assert.equal((await res.json()).error.code, "unauthenticated");
      }
      const noOrg = await get(base, path, signToken({ orgId: null }));
      assert.equal(noOrg.status, 403);
      assert.equal((await noOrg.json()).error.code, "no_active_org");
    }
  });
  // Without a database, a request that isn't signed in still gets 401, not 503.
  await withApi(null, async (base) => assert.equal((await get(base, "/v1/sessions")).status, 401));
});

test("503 when sign-in or the database isn't configured", async () => {
  const { db } = await seeded();
  await withApi(db, async (base) => {
    const res = await get(base, "/v1/sessions", tokenFor("org_a"));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "auth_unavailable");
  }, null);
  await withApi(null, async (base) => {
    for (const path of ["/v1/sessions", `/v1/sessions/${randomUUID()}`]) {
      const res = await get(base, path, tokenFor("org_a"));
      assert.equal(res.status, 503, path);
      assert.equal((await res.json()).error.code, "db_unavailable");
    }
  });
});

test("reads log no meeting URL, stage URL or token", async () => {
  const { db, a2 } = await seeded();
  await withApi(db, async (base, logs) => {
    const token = tokenFor("org_a");
    await get(base, "/v1/sessions", token);
    await get(base, `/v1/sessions/${a2.id}`, token);
    await get(base, `/v1/sessions/${randomUUID()}`, token);
    const text = JSON.stringify(logs);
    for (const secret of ["meet.google.com", "stage.example.com", token]) assert.ok(!text.includes(secret), secret);
  });
});

test("other methods on /v1/sessions answer 405 with Allow: GET, POST", async () => {
  await withApi(null, async (base) => {
    const res = await fetch(`${base}/v1/sessions`, { method: "DELETE" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, POST");
  });
});
