import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { settle, testStore } from "./helpers/store.ts";
import { createApp } from "../src/app.ts";
import { tokenMatches } from "../src/app.ts";
import { deriveMood, NEUTRAL_MOOD_INPUTS } from "../src/session/mood.ts";
import type { MoodInputs } from "../src/session/mood.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createStageChannel } from "../src/stage/channel.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { PatchBatch } from "../src/ui/schema.ts";

const ENV = {
  RECALL_REGION: "us-west-2",
  RECALL_API_KEY: "test-key",
  RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
  PUBLIC_API_BASE_URL: "https://agent.example.com/",
};

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

async function start(fakeFetch: typeof fetch = (async () => Response.json({ id: "bot-1" }, { status: 201 })) as any) {
  const config = loadConfig(ENV);
  const store = await testStore();
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeFetch, sleep: async () => {} });
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const log = (msg: string, fields?: Record<string, unknown>) => logs.push({ msg, fields });
  const server = http.createServer();
  let runtime!: ReturnType<typeof createRuntime>;
  const clientMessages: unknown[] = [];
  const channel = createStageChannel(
    server,
    async (id, token) => {
      if (!tokenMatches(token, (await store.getSession(id))?.stage_token ?? null)) return false;
      await runtime.load(id);
      return true;
    },
    (_id, msg) => clientMessages.push(msg),
    (id) => runtime(id).snapshot(),
  );
  runtime = createRuntime({ store, channel, log });
  const app = await createApp({ config, recall, store, runtime, log, indexHtml: "<html></html>", stageHtml: "<html>stage</html>" });
  server.on("request", app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const created = await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: "https://meet.google.com/abc-defg-hij" }) });
  const { session } = (await created.json()) as any;
  const token = new URL(((await (await fetch(`${base}/api/sessions/${session.id}`)).json()) as any).session.stage_url).searchParams.get("token")!;
  const wsUrl = (t: string | null = token) => `ws://127.0.0.1:${port}/stage/${session.id}/ws${t === null ? "" : `?token=${t}`}`;
  return { base, store, runtime, channel, logs, session, token, wsUrl, clientMessages };
}

// Opens a WebSocket and resolves with the socket plus a queue of parsed messages.
function connect(url: string) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const queue: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const m = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    const w = waiters.shift();
    if (w) w(m); else queue.push(m);
  });
  const next = (ms = 2000) => new Promise<any>((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    const t = setTimeout(() => reject(new Error("timed out waiting for message")), ms);
    waiters.push((m) => { clearTimeout(t); resolve(m); });
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("close", () => reject(new Error("ws closed")));
  });
  const closed = new Promise<void>((r) => ws.addEventListener("close", () => r()));
  return { ws, next, opened, closed, queue };
}

const addHeading: PatchBatch = {
  label: "Heading",
  ops: [{ op: "add", parentId: "home", node: { id: "home.heading", type: "Heading", props: { text: "Hi" }, status: "draft", children: [] } }],
};

test("deriveMood priority order", () => {
  const now = 1000;
  const base = NEUTRAL_MOOD_INPUTS;
  const table: [string, Partial<MoodInputs>, string][] = [
    ["nothing happening", {}, "listening"],
    ["speaking beats everything", { speaking: true, buildInFlight: true, buildStreaming: true, unsureUntil: 2000, pleasedUntil: 2000 }, "speaking"],
    ["unsure beats building", { unsureUntil: 2000, buildInFlight: true, buildStreaming: true }, "unsure"],
    ["expired unsure is ignored", { unsureUntil: 1000, lastSpeechWasQuestion: false }, "listening"],
    ["building while a run streams", { buildInFlight: true, buildStreaming: true, pleasedUntil: 2000 }, "building"],
    ["thinking while in flight but not streaming", { buildInFlight: true, pleasedUntil: 2000 }, "thinking"],
    ["thinking while addressed", { addressedUntil: 1500, pleasedUntil: 2000 }, "thinking"],
    ["pleased beats curious", { pleasedUntil: 1500, lastSpeechWasQuestion: true }, "pleased"],
    ["expired addressed window", { addressedUntil: 900 }, "listening"],
    ["curious after a question", { lastSpeechWasQuestion: true }, "curious"],
  ];
  for (const [name, input, expected] of table) assert.equal(deriveMood({ ...base, ...input }, now), expected, name);
});

test("ws rejects bad token at the upgrade and sends no snapshot", async () => {
  const ctx = await start();
  for (const url of [ctx.wsUrl("wrong"), ctx.wsUrl(null)]) {
    const c = connect(url);
    await assert.rejects(c.opened);
    assert.equal(c.queue.length, 0, "no snapshot received");
  }
  assert.equal(ctx.channel.clients(ctx.session.id), 0);
});

test("reconnect receives a full snapshot", async () => {
  const ctx = await start();
  const a = connect(ctx.wsUrl());
  await a.opened;
  assert.equal((await a.next()).type, "snapshot");
  assert.equal(ctx.channel.clients(ctx.session.id), 1);

  assert.deepEqual(ctx.runtime(ctx.session.id).applyBatch(addHeading), { ok: true });
  const patch = await a.next();
  assert.equal(patch.type, "patch");
  assert.deepEqual(patch.changes.map((c: any) => c.id), ["home.heading"]);
  a.ws.close();
  await a.closed;

  const b = connect(ctx.wsUrl());
  await b.opened;
  const snap = await b.next();
  assert.equal(snap.type, "snapshot");
  assert.equal(snap.uiScreen, "home");
  assert.ok(JSON.stringify(snap.proto).includes("home.heading"));
  b.ws.close();
  await b.closed;
});

test("audio frames carry the 36-byte utterance id then pcm", async () => {
  const ctx = await start();
  const c = connect(ctx.wsUrl());
  await c.opened;
  await c.next();
  const id = "11111111-2222-3333-4444-555555555555";
  ctx.channel.sendAudio(ctx.session.id, id, new Uint8Array([1, 2, 3, 4]));
  const frame = new Uint8Array(await c.next());
  assert.equal(Buffer.from(frame.subarray(0, 36)).toString("ascii"), id);
  assert.deepEqual([...frame.subarray(36)], [1, 2, 3, 4]);
  assert.throws(() => ctx.channel.sendAudio(ctx.session.id, "short", new Uint8Array(1)));
  c.ws.close();
  await c.closed;
});

test("client messages reach the handler", async () => {
  const ctx = await start();
  const c = connect(ctx.wsUrl());
  await c.opened;
  await c.next();
  c.ws.send(JSON.stringify({ type: "hello" }));
  c.ws.send("not json");
  await new Promise((r) => setTimeout(r, 100)); await settle();
  assert.deepEqual(ctx.clientMessages, [{ type: "hello" }]);
  c.ws.close();
  await c.closed;
});

test("applyBatch failure sends nothing and keeps persisted proto", async () => {
  const ctx = await start();
  const rt = ctx.runtime(ctx.session.id);
  assert.equal(rt.applyBatch(addHeading).ok, true);
  const c = connect(ctx.wsUrl());
  await c.opened;
  await c.next();

  const bad: PatchBatch = { label: "bad", ops: [{ op: "remove", id: "does.not.exist" }] };
  const r = rt.applyBatch(bad);
  assert.equal(r.ok, false);
  assert.ok(r.error);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(c.queue.length, 0, "nothing sent to the stage");
  await rt.saved();
  assert.ok(JSON.stringify((await ctx.store.getConsensus(ctx.session.id))!.proto).includes("home.heading"), "persisted proto unchanged");
  assert.ok(ctx.logs.some((l) => l.msg === "runtime.batch_rejected"));
  c.ws.close();
  await c.closed;
});

test("captions reach the stage as flags only and never enter the snapshot (known issue I7)", async () => {
  const store = await testStore();
  const s = await store.createIntent("22222222-2222-2222-2222-222222222222", "https://meet.google.com/x");
  const sent: StageEvent[] = [];
  const rt = createRuntime({ store, channel: { send: (_id, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } })(s.id);
  rt.caption({ partial: true, isAgent: false });
  rt.caption({ partial: false, isAgent: true });
  assert.deepEqual(sent, [
    { type: "caption", caption: { partial: true, isAgent: false } },
    { type: "caption", caption: { partial: false, isAgent: true } },
  ]);
  assert.equal("captions" in (rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>), false);
});

test("mood changes are pushed once, not on every input update", async () => {
  const store = await testStore();
  const s = await store.createIntent("33333333-3333-3333-3333-333333333333", "https://meet.google.com/x");
  const sent: StageEvent[] = [];
  const rt = createRuntime({ store, channel: { send: (_i, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } })(s.id);
  rt.updateMoodInputs({ speaking: true });
  rt.updateMoodInputs({ lastSpeechWasQuestion: true });
  rt.updateMoodInputs({ speaking: false });
  assert.deepEqual(sent, [{ type: "mood", mood: "speaking" }, { type: "mood", mood: "curious" }]);
});

function conflictDoc(): ConsensusDoc {
  const mk = (id: string): PatchBatch => ({
    label: id,
    ops: [{ op: "add", parentId: "home", node: { id, type: "Text", props: { text: id }, status: "draft", children: [] } }],
  });
  return {
    ...emptyDoc(),
    conflicts: [{
      id: "c1", topic: "t", status: "open", openedAt: 1,
      variants: [
        { label: "A", summary: "first", backers: ["Ada"], batch: mk("home.a") },
        { label: "B", summary: "second", backers: ["Bo"], batch: { label: "dup", ops: [{ op: "remove", id: "nope" }] } },
      ],
    }],
  };
}

test("resolveComparison applies the winner, resolves the doc, persists and sends resolve+patch+doc", async () => {
  const store = await testStore();
  const s = await store.createIntent("44444444-4444-4444-4444-444444444444", "https://meet.google.com/x");
  const sent: StageEvent[] = [];
  const rt = createRuntime({ store, channel: { send: (_i, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } })(s.id);
  rt.setDoc(conflictDoc());
  sent.length = 0;
  assert.deepEqual(rt.resolveComparison("c1", "A"), { ok: true, applied: true });
  assert.deepEqual(sent.map((e) => e.type), ["resolve", "patch", "doc"]);
  await rt.saved();
  const saved = (await store.getConsensus(s.id))!;
  assert.equal(saved.doc.conflicts[0].status, "resolved");
  assert.equal(saved.doc.conflicts[0].winner, "A");
  assert.ok(JSON.stringify(saved.proto).includes("home.a"));
  // Resolving again is idempotent: nothing is applied, changed or sent twice, even for another label.
  sent.length = 0;
  const saved1 = JSON.stringify(await store.getConsensus(s.id));
  assert.deepEqual(rt.resolveComparison("c1", "A"), { ok: true, applied: false }, "already resolved: not re-applied");
  assert.deepEqual(rt.resolveComparison("c1", "B"), { ok: true, applied: false });
  assert.deepEqual(sent, []);
  await rt.saved();
  assert.equal(JSON.stringify(await store.getConsensus(s.id)), saved1);
  assert.equal(rt.resolveComparison("nope", "A").ok, false);
});

test("resolveComparison with an unappliable winner batch still resolves the doc and keeps the proto", async () => {
  const store = await testStore();
  const s = await store.createIntent("55555555-5555-5555-5555-555555555555", "https://meet.google.com/x");
  const sent: StageEvent[] = [];
  const logs: string[] = [];
  const rt = createRuntime({ store, channel: { send: (_i, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 }, log: (m) => logs.push(m) })(s.id);
  rt.setDoc(conflictDoc());
  await rt.saved();
  const before = JSON.stringify((await store.getConsensus(s.id))!.proto);
  sent.length = 0;
  assert.deepEqual(rt.resolveComparison("c1", "B"), { ok: true, applied: false });
  assert.deepEqual(sent.map((e) => e.type), ["resolve", "doc"]);
  await rt.saved();
  const saved = (await store.getConsensus(s.id))!;
  assert.equal(saved.doc.conflicts[0].status, "resolved");
  assert.equal(JSON.stringify(saved.proto), before);
  assert.deepEqual(logs, ["runtime.winner_batch_rejected"]);
});

test("script endpoint drives the stage over the websocket (todo fixture)", async () => {
  const ctx = await start();
  const c = connect(ctx.wsUrl());
  await c.opened;
  await c.next();
  const script = readFileSync(new URL("./fixtures/script-todo.json", import.meta.url), "utf8");
  const res = await fetch(`${ctx.base}/api/sessions/${ctx.session.id}/script`, { method: "POST", body: script });
  assert.equal(res.status, 200);
  const { results } = (await res.json()) as any;
  assert.ok(results.every((r: any) => r.ok), JSON.stringify(results));
  const types: string[] = [];
  while (c.queue.length) types.push(c.queue.shift().type);
  while (types.length < 10) { try { types.push((await c.next(300)).type); } catch { break; } }
  assert.deepEqual(types, ["caption", "mood", "patch", "doc", "comparison", "resolve", "patch", "doc", "mood"]);
  const state = (await (await fetch(`${ctx.base}/stage/${ctx.session.id}/state?token=${ctx.token}`)).json()) as any;
  assert.equal(state.type, "snapshot");
  assert.ok(JSON.stringify(state.proto).includes("home.list"));
  assert.equal(state.comparison, null);
  assert.equal(state.mood, "pleased");
  c.ws.close();
  await c.closed;
});

test("script endpoint rejects malformed scripts", async () => {
  const ctx = await start();
  const res = await fetch(`${ctx.base}/api/sessions/${ctx.session.id}/script`, { method: "POST", body: JSON.stringify({ steps: [{ batch: { nope: 1 } }] }) });
  assert.equal(res.status, 400);
});

test("renderer assets are public through the tunnel; script endpoint is not", async () => {
  const ctx = await start();
  const proxied = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9" };
  const js = await fetch(`${ctx.base}/renderer/render.js`, { headers: proxied });
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type")!, /javascript/);
  assert.equal((await fetch(`${ctx.base}/renderer/missing.js`, { headers: proxied })).status, 404);
  assert.equal((await fetch(`${ctx.base}/renderer/..%2Findex.html`, { headers: proxied })).status, 404);
  const img = await fetch(`${ctx.base}/renderer/images/food-1.webp`, { headers: proxied });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/webp");
  for (const bad of ["/renderer/images/..%2Fapp.ts", "/renderer/images/../app.ts", "/renderer/images/x.js", "/renderer/images/nope-1.webp"]) {
    assert.equal((await fetch(`${ctx.base}${bad}`, { headers: proxied })).status, 404, bad);
  }
  const script = await fetch(`${ctx.base}/api/sessions/${ctx.session.id}/script`, { method: "POST", body: JSON.stringify({ steps: [] }), headers: proxied });
  assert.equal(script.status, 404);
  assert.equal((await fetch(`${ctx.base}/api/sessions/${ctx.session.id}/script`, { method: "POST", body: JSON.stringify({ steps: [] }) })).status, 200);
});

test("createBot sends bot_name Builder and variant web_4_core by default", async () => {
  const bodies: any[] = [];
  await start((async (_u: string, init: RequestInit) => {
    if (init.body) bodies.push(JSON.parse(init.body as string));
    return Response.json({ id: "bot-9" }, { status: 201 });
  }) as any);
  const create = bodies.find((b) => b.bot_name);
  assert.equal(create.bot_name, "Builder");
  assert.equal(create.variant.google_meet, "web_4_core");
});

const mkRuntime = async (id: string, sent: StageEvent[]) => {
  const store = await testStore();
  const s = await store.createIntent(id, "https://meet.google.com/x");
  return createRuntime({ store, channel: { send: (_i, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } })(s.id);
};
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("pleased mood expires and pushes listening after the window", async () => {
  const sent: StageEvent[] = [];
  const rt = await mkRuntime("66666666-6666-6666-6666-666666666666", sent);
  rt.updateMoodInputs({ pleasedUntil: Date.now() + 60 });
  assert.deepEqual(sent, [{ type: "mood", mood: "pleased" }]);
  await sleepMs(200);
  assert.deepEqual(sent, [{ type: "mood", mood: "pleased" }, { type: "mood", mood: "listening" }]);
});

test("re-setting a window after expiry pushes again (lastMood resynced)", async () => {
  const sent: StageEvent[] = [];
  const rt = await mkRuntime("77777777-7777-7777-7777-777777777777", sent);
  rt.updateMoodInputs({ pleasedUntil: Date.now() + 40 });
  await sleepMs(150);
  rt.updateMoodInputs({ pleasedUntil: Date.now() + 5000 });
  assert.deepEqual(sent.map((e: any) => e.mood), ["pleased", "listening", "pleased"]);
  rt.updateMoodInputs({ pleasedUntil: 0 });
});

test("snapshotFor throwing terminates only that socket and the server keeps serving", async () => {
  const server = http.createServer((_q, res) => res.end("ok"));
  openServers.add(server);
  const logs: string[] = [];
  let boom = true;
  createStageChannel(server, () => true, () => {}, () => {
    if (boom) throw new Error("corrupt secret text");
    return { type: "speech_stop" };
  }, (m) => logs.push(m));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const id = "88888888-8888-8888-8888-888888888888";
  const bad = connect(`ws://127.0.0.1:${port}/stage/${id}/ws?token=x`);
  await bad.closed;
  assert.equal(bad.queue.length, 0);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200, "server still serving");
  boom = false;
  const good = connect(`ws://127.0.0.1:${port}/stage/${id}/ws?token=x`);
  await good.opened;
  assert.equal((await good.next()).type, "speech_stop");
  assert.deepEqual(logs, ["channel.snapshot_failed"]);
  good.ws.close();
  await good.closed;
});

test("a stage auth check that fails (a database error, say) rejects the socket and logs the code only", async () => {
  const server = http.createServer((_q, res) => res.end("ok"));
  openServers.add(server);
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const dbError = Object.assign(new Error("query quoted secret meeting text"), { kind: "Query", details: { kind: "TimedOut" } });
  createStageChannel(server, async () => { throw dbError; }, () => {}, () => ({ type: "speech_stop" }), (msg, fields) => logs.push({ msg, fields }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const id = "77777777-7777-7777-7777-777777777777";
  const ws = connect(`ws://127.0.0.1:${port}/stage/${id}/ws?token=x`);
  ws.opened.catch(() => {}); // it never opens
  await ws.closed;
  assert.equal(ws.queue.length, 0, "nothing was sent");
  // The client may try the upgrade more than once; each attempt is refused and logged the same way.
  assert.ok(logs.length >= 1);
  for (const l of logs) assert.deepEqual(l, { msg: "channel.auth_failed", fields: { session_id: id, error: "Query.TimedOut" } });
});

test("setTasks pushes a tasks event and the snapshot carries the list", async () => {
  const store = await testStore();
  const s = await store.createIntent("33333333-3333-3333-3333-333333333333", "https://meet.google.com/x");
  const sent: StageEvent[] = [];
  const rt = createRuntime({ store, channel: { send: (_id, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } })(s.id);
  assert.deepEqual((rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>).tasks, []);
  const tasks = [{ id: "t1", text: "Adding the buttons", state: "now" as const }];
  rt.setTasks(tasks);
  assert.deepEqual(sent, [{ type: "tasks", tasks }]);
  assert.deepEqual((rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>).tasks, tasks);
});

test("the operator's cost poll reads one total, and only locally (known issue M7)", async () => {
  const ctx = await start();
  const cost = (headers: Record<string, string> = {}) => fetch(`${ctx.base}/api/sessions/${ctx.session.id}/cost`, { headers });
  assert.deepEqual(await (await cost()).json(), { cost_usd: 0 });
  for (const usd of [0.25, 0.5]) {
    await ctx.store.addModelCall({ sessionId: ctx.session.id, loop: "build", model: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd, ms: 1 });
  }
  assert.deepEqual(await (await cost()).json(), { cost_usd: 0.75 });
  assert.equal((await cost({ "x-forwarded-for": "203.0.113.9" })).status, 404, "not through the tunnel");
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(page.includes("fetch(`/api/sessions/${current.id}/cost`)"), "the operator page polls the total, not the whole session");
});

test("saving is in the background but in order: a slow first write never lands over a later one", async () => {
  const store = await testStore();
  const s = await store.createIntent("99999999-9999-9999-9999-999999999999", "https://meet.google.com/x");
  let first = true;
  const slowFirst = {
    getConsensus: store.getConsensus,
    async saveConsensus(...args: Parameters<typeof store.saveConsensus>) {
      if (first) {
        first = false;
        await sleepMs(30);
      }
      return store.saveConsensus(...args);
    },
  };
  const rt = createRuntime({ store: slowFirst, channel: { send() {}, sendAudio() {}, clients: () => 0 } })(s.id);
  rt.setDoc({ ...emptyDoc(), nextUp: ["first"] });
  rt.setDoc({ ...emptyDoc(), nextUp: ["second"] });
  await rt.saved();
  assert.deepEqual((await store.getConsensus(s.id))!.doc.nextUp, ["second"]);
  await store.close();
});

test("a failed save is logged by name and the session carries on", async () => {
  const store = await testStore();
  const s = await store.createIntent("aaaaaaaa-9999-9999-9999-999999999999", "https://meet.google.com/x");
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const broken = { getConsensus: store.getConsensus, saveConsensus: async () => { throw new Error("secret text"); } };
  const rt = createRuntime({ store: broken, channel: { send() {}, sendAudio() {}, clients: () => 0 }, log: (msg, fields) => logs.push({ msg, fields }) })(s.id);
  rt.setDoc({ ...emptyDoc(), nextUp: ["x"] });
  await rt.saved();
  assert.deepEqual(logs, [{ msg: "runtime.persist_failed", fields: { session_id: s.id, error: "Error" } }]);
  assert.deepEqual((rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>).doc.nextUp, ["x"], "memory is what the session runs on");
  await store.close();
});

test("after a restart, load() starts a session's runtime from what was saved, once", async () => {
  const store = await testStore();
  const s = await store.createIntent("bbbbbbbb-9999-9999-9999-999999999999", "https://meet.google.com/x");
  const before = createRuntime({ store, channel: { send() {}, sendAudio() {}, clients: () => 0 } })(s.id);
  before.applyBatch(addHeading);
  await before.saved();

  let reads = 0;
  const counting = { ...store, getConsensus: (id: string) => { reads++; return store.getConsensus(id); } };
  const runtime = createRuntime({ store: counting, channel: { send() {}, sendAudio() {}, clients: () => 0 } });
  const [a, b] = await Promise.all([runtime.load(s.id), runtime.load(s.id)]);
  assert.equal(a, b, "one runtime per session");
  assert.equal(reads, 1, "concurrent loads share one read");
  assert.equal(runtime(s.id), a);
  assert.ok(JSON.stringify((a.snapshot() as Extract<StageEvent, { type: "snapshot" }>).proto).includes("home.heading"));
  await runtime.load(s.id);
  assert.equal(reads, 1, "a loaded session is not read again");
  await store.close();
});

test("R3: flush waits for every session's queued saves", async () => {
  const store = await testStore();
  const ids = ["55555555-0000-0000-0000-000000000001", "55555555-0000-0000-0000-000000000002"];
  for (const id of ids) await store.createIntent(id, "https://meet.google.com/x");
  let saving = 0;
  const slow = { getConsensus: store.getConsensus, saveConsensus: async (...a: Parameters<typeof store.saveConsensus>) => {
    saving++;
    await new Promise((r) => setTimeout(r, 30));
    return store.saveConsensus(...a);
  } };
  const runtime = createRuntime({ store: slow, channel: { send() {}, sendAudio() {}, clients: () => 0 } });
  for (const id of ids) runtime(id).setDoc(conflictDoc());
  await runtime.flush();
  assert.equal(saving, 2);
  for (const id of ids) assert.equal((await store.getConsensus(id))?.doc.conflicts[0].id, "c1");
});
