// With an async store, two requests or two Recall events can interleave at every await (docs/adr/0007).
// These pin the guarantees the synchronous SQLite store gave for free.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { testStore } from "./helpers/store.ts";
import type { Store } from "../src/store.ts";
import { createApp, REALTIME_PATH } from "../src/app.ts";
import { signForTest } from "../src/verify.ts";

const SECRET = "whsec_" + Buffer.from("unit-test-secret").toString("base64");
const ENV = {
  RECALL_REGION: "us-west-2", RECALL_API_KEY: "test-key", RECALL_WEBHOOK_VERIFICATION_SECRET: SECRET,
  PUBLIC_API_BASE_URL: "https://agent.example.com/",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const servers = new Set<http.Server>();
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

async function start(fakeFetch: (url: string) => Promise<Response>, wrap: (store: Store) => Store = (s) => s) {
  const config = loadConfig(ENV);
  const store = await testStore();
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeFetch as typeof fetch, sleep: async () => {} });
  const app = await createApp({ config, recall, store: wrap(store), log: (msg, fields) => logs.push({ msg, fields }), indexHtml: "", stageHtml: "" });
  const server = http.createServer(app.handler);
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, store, logs, app };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });

const utterance = (sessionId: string, botId: string, words: string[]) => JSON.stringify({
  event: "transcript.data",
  data: { bot: { id: botId, metadata: { session_id: sessionId } }, data: { participant: { name: "Ada" }, words: words.map((text) => ({ text })) } },
});

async function until(check: () => Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(5);
  }
}

test("the scheduling intent is stored before Recall is asked for a bot", async () => {
  const seen: (string | undefined)[] = [];
  let ctx!: Awaited<ReturnType<typeof start>>;
  ctx = await start(async (url) => {
    if (url.endsWith("/bot/")) seen.push((await ctx.store.findActiveForMeeting("https://meet.google.com/int-entf-rst"))?.state);
    return Response.json({ id: "bot-1" }, { status: 201 });
  });
  const res = await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/int-entf-rst" });
  assert.equal(res.status, 201);
  assert.deepEqual(seen, ["intent"], "the intent row exists while the Recall call is in flight");
  assert.equal(((await res.json()) as { session: { state: string } }).session.state, "created");
});

test("two requests for the same meeting at once send one bot", async () => {
  let creates = 0;
  let lookups = 0;
  const ctx = await start(
    async (url) => {
      if (url.endsWith("/bot/")) {
        creates++;
        await sleep(20);
      }
      return Response.json({ id: `bot-${creates}` }, { status: 201 });
    },
    // The first request's lookup is slow, so the second one's starts before the first has written its intent.
    (store) => ({
      ...store,
      async findActiveForMeeting(meetingUrl: string) {
        if (++lookups === 1) await sleep(40);
        return store.findActiveForMeeting(meetingUrl);
      },
    }),
  );
  const meeting = { meeting_url: "https://meet.google.com/one-bott-only" };
  const statuses = (await Promise.all([post(`${ctx.base}/api/sessions`, meeting), post(`${ctx.base}/api/sessions`, meeting)])).map((r) => r.status);
  assert.equal(creates, 1, "never a second bot");
  // As before: the second request finds the first one's unresolved intent.
  assert.deepEqual(statuses.sort(), [201, 409]);
});

test("the same Recall event delivered twice at once is stored and acted on once", async () => {
  const ctx = await start(async () => Response.json({ id: "bot-2" }, { status: 201 }));
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/dup-lica-tes" })).json()) as { session: { id: string } };
  const payload = utterance(session.id, "bot-2", ["once", "only"]);
  const headers = signForTest(SECRET, payload, "msg-dup");
  const res = await Promise.all([1, 2, 3].map(() => post(`${ctx.base}${REALTIME_PATH}`, payload, headers)));
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200]);
  await until(async () => ctx.logs.filter((l) => l.msg === "realtime.processed" || l.msg === "realtime.duplicate").length === 3);
  assert.equal((await ctx.store.listEvents(session.id)).length, 1);
  assert.equal(ctx.logs.filter((l) => l.msg === "realtime.processed").length, 1);
  assert.equal(ctx.logs.filter((l) => l.msg === "realtime.duplicate").length, 2);
});

test("events for a session are stored in the order they arrived, even when the first one's lookup is slow", async () => {
  let slowNext = false;
  const ctx = await start(
    async () => Response.json({ id: "bot-3" }, { status: 201 }),
    (store) => ({
      ...store,
      async getSession(id: string) {
        if (slowNext) {
          slowNext = false;
          await sleep(40);
        }
        return store.getSession(id);
      },
    }),
  );
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/ord-erin-gok" })).json()) as { session: { id: string } };
  const first = utterance(session.id, "bot-3", ["first"]);
  const second = utterance(session.id, "bot-3", ["second"]);
  slowNext = true;
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, first, signForTest(SECRET, first, "m-1"))).status, 200);
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, second, signForTest(SECRET, second, "m-2"))).status, 200);
  await until(async () => (await ctx.store.listEvents(session.id)).length === 2);
  const events = await ctx.store.listEvents(session.id);
  assert.deepEqual(events.map((e) => e.text), ["first", "second"], "ids follow arrival order");
});

test("R3: drain waits for realtime events that were answered but not yet stored", async () => {
  let slow = false;
  const ctx = await start(
    async () => Response.json({ id: "bot-4" }, { status: 201 }),
    (store) => ({
      ...store,
      async getSession(id: string) {
        if (slow) await sleep(40);
        return store.getSession(id);
      },
    }),
  );
  const { session } = (await (await post(`${ctx.base}/api/sessions`, { meeting_url: "https://meet.google.com/dra-inin-gok" })).json()) as { session: { id: string } };
  slow = true;
  const first = utterance(session.id, "bot-4", ["first"]);
  const second = utterance(session.id, "bot-4", ["second"]);
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, first, signForTest(SECRET, first, "d-1"))).status, 200);
  assert.equal((await post(`${ctx.base}${REALTIME_PATH}`, second, signForTest(SECRET, second, "d-2"))).status, 200);
  await ctx.app.drain();
  assert.deepEqual((await ctx.store.listEvents(session.id)).map((e) => e.text), ["first", "second"]);
});
