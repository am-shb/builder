// End to end: the todo-app fixture is replayed as signed Recall webhooks into a real app on an
// ephemeral loopback port, with scripted models and a recording voice. Time is virtual: the
// replay's sleep advances a manual clock, so the 30 s promotion and the stuck silence cost nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { settle, testStore } from "./helpers/store.ts";
import { createApp } from "../src/app.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { noopStageSink } from "../src/stage/channel.ts";
import { createRoutedFakePort } from "../src/agent/llm.ts";
import type { Speech } from "../src/agent/conversation-loop.ts";
import { findNode } from "../src/ui/tree.ts";
import { asrText, replay } from "../scripts/replay.ts";
import type { Fixture } from "../scripts/replay.ts";

const flush = () => settle(30);
const fixture: Fixture = JSON.parse(readFileSync(new URL("./fixtures/sessions/todo-app.json", import.meta.url), "utf8"));
const servers = new Set<http.Server>();
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

// Manual clock and timers for the build loop's ticks and floor.
function virtualTime(start = 1_700_000_000_000) {
  let t = start;
  let seq = 0;
  const tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
  return {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => { tasks.set(++seq, { at: t + ms, fn }); return seq; },
    clearTimeout: (id: unknown) => { tasks.delete(id as number); },
    setInterval: (fn: () => void, ms: number) => { tasks.set(++seq, { at: t + ms, fn, every: ms }); return seq; },
    clearInterval: (id: unknown) => { tasks.delete(id as number); },
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...tasks.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, task] = due;
        t = task.at;
        if (task.every) task.at += task.every;
        else tasks.delete(id);
        task.fn();
        await flush();
      }
      t = end;
    },
  };
}

// Clean text, and the lowercase unpunctuated lines Recall's low-latency transcript really gives.
for (const asr of [false, true]) test(`todo-app session replays end to end${asr ? " (low-latency transcript text)" : ""}`, async () => {
  const secret = "whsec_" + Buffer.from("e2e-replay-secret-not-real").toString("base64");
  const config = loadConfig({
    RECALL_REGION: "us-west-2", RECALL_API_KEY: "fake-key", RECALL_WEBHOOK_VERIFICATION_SECRET: secret,
    PUBLIC_API_BASE_URL: "https://e2e.example.com",
  });
  const fakeRecall: typeof fetch = async (input) => {
    const u = String(input);
    if (u.endsWith("/bot/")) return Response.json({ id: "bot-e2e-1" }, { status: 201 });
    return Response.json({ id: "bot-e2e-1", status_changes: [{ code: "in_call_recording", sub_code: null, message: null, created_at: "" }] });
  };
  const store = await testStore();
  const time = virtualTime();
  const runtime = createRuntime({ store, clock: time.now, channel: noopStageSink });
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const said: string[] = [];
  const speech: Speech = { say: async (_s, text) => { said.push(text); return `u${said.length}`; }, stop() {}, speaking: () => false };
  const app = await createApp({
    config, store, runtime, log: (msg, fields) => logs.push({ msg, fields }),
    recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeRecall, sleep: async () => {} }),
    agent: { port: createRoutedFakePort(fixture.fakeModel!), speech, clock: time.now, timers: time },
  });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.add(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const created = await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: "https://meet.google.com/abc-defg-hij" }) });
  const { session } = (await created.json()) as { session: { id: string } };
  await app.pollOnce(); // the bot is recording

  // The replay's sleep is the test's clock: virtual seconds pass, the stuck poll runs each second.
  const sleep = async (ms: number) => {
    for (let left = ms; left > 0; left -= 1000) {
      await time.advance(Math.min(1000, left));
      app.tickAgent();
      await flush();
    }
    await flush();
  };
  const result = await replay(fixture, { baseUrl: base, sessionId: session.id, secret, sleep, asr });
  assert.equal(result.posted, fixture.participants.length + fixture.utterances.length);

  // Speech: exactly the four allowed reasons, in order.
  const spoke = logs.filter((l) => l.msg === "speak").map((l) => l.fields!.reason);
  assert.deepEqual(spoke, ["opening", "confirm_conflict", "answer", "stuck"]);
  assert.equal(said.length, 4);
  // Builder confirms the spoken pick itself, so the model's own confirm_conflict finds nothing left to confirm.
  const blocked = logs.filter((l) => l.msg === "speak.blocked").map((l) => `${l.fields!.reason}:${l.fields!.why}`);
  assert.deepEqual(blocked, ["confirm_conflict:reason_not_open"]);

  // Consensus: three decisions agreed by support or silence, and the conflict resolved with B.
  await runtime(session.id).saved();
  const { doc, proto } = (await store.getConsensus(session.id))!;
  const agreed = (id: string) => doc.decisions.find((d) => d.id === id);
  assert.equal(agreed("d-quick-add")?.status, "agreed");
  assert.deepEqual(agreed("d-quick-add")?.agreedBy, ["Bo"]);
  assert.equal(agreed("d-owner-badge")?.status, "agreed");
  assert.equal(agreed("d-due-dates")?.status, "agreed", "promoted after 30 s without objection");
  assert.deepEqual(agreed("d-due-dates")?.agreedBy, []);
  assert.ok(logs.some((l) => l.msg === "build.promoted" && l.fields!.decision_id === "d-due-dates" && l.fields!.via === "timeout"));
  assert.equal(doc.conflicts[0].status, "resolved");
  assert.equal(doc.conflicts[0].winner, "B");
  assert.equal(agreed("d-c-done")?.status, "agreed");
  assert.deepEqual(agreed("d-c-done")?.rejectedOptions, ["Hide done tasks behind a Show done switch"]);

  // Prototype: the merged variant B is in, option A never landed, agreed decisions' nodes are agreed.
  assert.ok(findNode(proto, "home.tabs"), "variant B merged");
  assert.ok(!findNode(proto, "home.show-done"));
  assert.equal(findNode(proto, "home.add")?.status, "agreed");
  assert.equal(findNode(proto, "home.due")?.status, "agreed");

  // The voice command ran on the stage (visible, so Builder stayed quiet about it).
  assert.ok(logs.some((l) => l.msg === "conversation.command" && l.fields!.ok === true && l.fields!.visible === true));

  // Cost: every scripted call was recorded, 12 conversation and 8 build (the spoken pick starts a run of its own).
  const calls = await store.listModelCalls(session.id);
  assert.equal(calls.filter((c) => c.loop === "conversation").length, 12);
  assert.equal(calls.filter((c) => c.loop === "build").length, 8);
  assert.ok(await store.sessionCost(session.id) > 0);

  // Handoff page lists the decisions; the export is self-contained.
  const token = (await store.getSession(session.id))!.handoff_token!;
  const page = await (await fetch(`${base}/handoff/${session.id}?token=${token}`)).text();
  for (const d of doc.decisions.filter((x) => x.status === "agreed")) assert.ok(page.includes(d.text), `handoff lists ${d.id}`);
  const exported = await (await fetch(`${base}/handoff/${session.id}/export?token=${token}`)).text();
  assert.doesNotMatch(exported, /http/);

  // Logs never carry transcript text or Builder's lines.
  const logged = JSON.stringify(logs);
  for (const u of fixture.utterances) assert.ok(!logged.includes(u.text) && !logged.includes(asrText(u.text)), "no transcript text in logs");
  for (const line of said) assert.ok(!logged.includes(line), "no spoken text in logs");
});

test("the routed fake port sends each call to its own loop's script", async () => {
  const port = createRoutedFakePort({
    conversation: [[{ name: "speak", input: { text: "a", reason: "opening" } }]],
    build: [[], [{ name: "update_consensus", input: { ops: [] } }]],
  });
  const req = { system: "", messages: [], tools: [], effort: "low" as const };
  assert.equal((await port.runTools({ ...req, loop: "build" })).toolCalls.length, 0);
  assert.equal((await port.runTools({ ...req, loop: "conversation" })).toolCalls[0].name, "speak");
  const second = await port.runTools({ ...req, loop: "build" });
  assert.equal(second.toolCalls[0].name, "update_consensus");
  assert.ok(second.usage.inputTokens > 0, "nonzero usage so cost accounting has something to record");
});

// ---- local replay: plain lines into /speech, optionally waiting for the stage ----
function tinyServer(handler: (req: http.IncomingMessage, body: string) => unknown) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(handler(req, body))); });
  });
  servers.add(server);
  return new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
}

test("local replay posts unsigned lines to /speech", async () => {
  const seen: { url?: string; sig: unknown; body: any }[] = [];
  const base = await tinyServer((req, body) => { seen.push({ url: req.url, sig: req.headers["webhook-signature"], body: JSON.parse(body) }); return { ok: true }; });
  const f: Fixture = { participants: ["Ada"], utterances: [{ t: 10, speaker: "Ada", text: "hello there" }, { t: 20, speaker: "Ada", text: "half", partial: true }] };
  const result = await replay(f, { baseUrl: base, sessionId: "s1", secret: "", local: true, sleep: async () => {} });
  assert.equal(result.posted, 3);
  assert.deepEqual(seen.map((s) => s.url), Array(3).fill("/api/sessions/s1/speech"));
  assert.deepEqual(seen.map((s) => s.body.kind), ["join", "utterance", "partial"]);
  assert.deepEqual(seen[1].body, { kind: "utterance", speaker: "Ada", text: "hello there" });
  assert.ok(seen.every((s) => s.sig === undefined));
});

test("asr replay sends every line lowercase and without punctuation, locally and as webhook words", async () => {
  assert.equal(asrText("Let's go with B, the Done tab."), "let's go with b the done tab");
  assert.equal(asrText("Hey Builder, what have we agreed so far?"), "hey builder what have we agreed so far");
  const seen: any[] = [];
  const base = await tinyServer((_req, body) => { seen.push(JSON.parse(body)); return { ok: true }; });
  const f: Fixture = { participants: [], utterances: [{ t: 0, speaker: "Ada", text: "Okay. I think B is better!" }, { t: 1, speaker: "Ada", text: "Half-way", partial: true }] };
  await replay(f, { baseUrl: base, sessionId: "s1", secret: "", local: true, asr: true, sleep: async () => {} });
  assert.deepEqual(seen.map((b) => b.text), ["okay i think b is better", "half way"]);
  seen.length = 0;
  await replay(f, { baseUrl: base, sessionId: "s1", secret: "whsec_" + Buffer.from("x").toString("base64"), asr: true, sleep: async () => {} });
  assert.deepEqual(seen.map((b) => b.data.data.words.map((w: { text: string }) => w.text).join(" ")), ["okay i think b is better", "half way"]);
});

test("waitFor comparison polls the stage state before posting the line", async () => {
  const order: string[] = [];
  let polls = 0;
  const base = await tinyServer((req) => {
    if (req.url!.startsWith("/state")) { polls++; order.push("poll"); return { comparison: polls > 2 ? { conflictId: "c1" } : null }; }
    order.push("post");
    return { ok: true };
  });
  const f: Fixture = { participants: [], utterances: [{ t: 0, speaker: "Ada", text: "go with B", waitFor: "comparison" }] };
  await replay(f, { baseUrl: base, sessionId: "s1", secret: "", local: true, stateUrl: `${base}/state?token=x`, sleep: async () => {} });
  assert.deepEqual(order, ["poll", "poll", "poll", "post"]);
});

test("waitFor no-comparison waits for it to clear; a timeout throws", async () => {
  let polls = 0;
  const base = await tinyServer((req) => req.url!.startsWith("/state") ? { comparison: ++polls > 1 ? null : { conflictId: "c1" } } : { ok: true });
  const f: Fixture = { participants: [], utterances: [{ t: 0, speaker: "Ada", text: "ok", waitFor: "no-comparison" }] };
  await replay(f, { baseUrl: base, sessionId: "s1", secret: "", local: true, stateUrl: `${base}/state`, sleep: async () => {} });
  assert.equal(polls, 2);

  const never = await tinyServer(() => ({ comparison: null }));
  const g: Fixture = { participants: [], utterances: [{ t: 0, speaker: "Ada", text: "ok", waitFor: "comparison" }] };
  await assert.rejects(
    replay(g, { baseUrl: never, sessionId: "s1", secret: "", local: true, stateUrl: `${never}/state`, sleep: async () => {}, waitTimeoutMs: 700 }),
    /waitFor comparison timed out/,
  );
});

test("a shot is taken 8 s of scripted time after its line, divided by speed", async () => {
  const base = await tinyServer(() => ({ ok: true }));
  const slept: number[] = [];
  const shots: string[] = [];
  const f: Fixture = { participants: [], utterances: [{ t: 0, speaker: "Ada", text: "ok", shot: "beat1" }] };
  await replay(f, { baseUrl: base, sessionId: "s1", secret: "", local: true, speed: 2, sleep: async (ms) => { slept.push(ms); }, onShot: async (n) => { shots.push(n); } });
  assert.deepEqual(shots, ["beat1"]);
  assert.ok(slept.includes(4000));
});
