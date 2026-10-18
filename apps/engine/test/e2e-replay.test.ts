// End to end: the todo-app fixture is replayed as signed Recall webhooks into a real app on an
// ephemeral loopback port, with scripted models and a recording voice. Time is virtual: the
// replay's sleep advances a manual clock, so the 30 s promotion and the stuck silence cost nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { testStore } from "./helpers/store.ts";
import { createApp } from "../src/app.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { noopStageSink } from "../src/stage/channel.ts";
import { createRoutedFakePort } from "../src/agent/llm.ts";
import type { Speech } from "../src/agent/conversation-loop.ts";
import { findNode } from "../src/ui/tree.ts";
import { replay } from "../scripts/replay.ts";
import type { Fixture } from "../scripts/replay.ts";

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r)); };
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

test("todo-app session replays end to end", async () => {
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
  const result = await replay(fixture, { baseUrl: base, sessionId: session.id, secret, sleep });
  assert.equal(result.posted, fixture.participants.length + fixture.utterances.length);

  // Speech: exactly the four allowed reasons, in order.
  const spoke = logs.filter((l) => l.msg === "speak").map((l) => l.fields!.reason);
  assert.deepEqual(spoke, ["opening", "confirm_conflict", "answer", "stuck"]);
  assert.equal(said.length, 4);
  assert.equal(logs.filter((l) => l.msg === "speak.blocked").length, 0);

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

  // Cost: every scripted call was recorded, 12 conversation and 7 build.
  const calls = await store.listModelCalls(session.id);
  assert.equal(calls.filter((c) => c.loop === "conversation").length, 12);
  assert.equal(calls.filter((c) => c.loop === "build").length, 7);
  assert.ok(await store.sessionCost(session.id) > 0);

  // Handoff page lists the decisions; the export is self-contained.
  const token = (await store.getSession(session.id))!.handoff_token!;
  const page = await (await fetch(`${base}/handoff/${session.id}?token=${token}`)).text();
  for (const d of doc.decisions.filter((x) => x.status === "agreed")) assert.ok(page.includes(d.text), `handoff lists ${d.id}`);
  const exported = await (await fetch(`${base}/handoff/${session.id}/export?token=${token}`)).text();
  assert.doesNotMatch(exported, /http/);

  // Logs never carry transcript text or Builder's lines.
  const logged = JSON.stringify(logs);
  for (const u of fixture.utterances) assert.ok(!logged.includes(u.text), "no transcript text in logs");
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
