import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { settle, testStore } from "./helpers/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createFakePort, createOpenRouterPort, MODELS } from "../src/agent/llm.ts";
import type { ModelPort, PortTool, RunToolsRequest, RunToolsResult, ToolCall } from "../src/agent/llm.ts";
import { HandoffSchema, HandoffToolInput } from "../src/agent/handoff.ts";
import type { Handoff } from "../src/agent/handoff.ts";
import { createChatSpeech, createConversationLoop, ADDRESSED_MS, FOLLOW_UP_MS, OPENING_MAX, WINDOW } from "../src/agent/conversation-loop.ts";
import type { CommandOutcome, Speech, UiCommand } from "../src/agent/conversation-loop.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import { findNode } from "../src/ui/tree.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { createApp, REALTIME_PATH } from "../src/app.ts";
import { signForTest } from "../src/verify.ts";

const flush = () => settle();
const T0 = 1_700_000_000_000;

type Snapshot = Extract<StageEvent, { type: "snapshot" }>;

// A port whose calls wait until released, to hold a model call in flight.
function heldPort() {
  const calls: { req: RunToolsRequest; resolve: (r: RunToolsResult) => void }[] = [];
  const port: ModelPort = { runTools: (req) => new Promise((resolve) => calls.push({ req, resolve })) };
  const release = async (i: number, toolCalls: ToolCall[] = []) => {
    calls[i].resolve({
      toolCalls, ms: 5, dropped: 0, stopReason: toolCalls.length ? "tool_use" : "end_turn",
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    await flush();
  };
  return { port, calls, release };
}

// One database for the file: each test works in its own new session, and starting a database per test
// would cost more than the tests themselves.
const sharedStore = testStore();

async function setup(portOrScript: ModelPort | ToolCall[][], opts: { uiCommand?: (sessionId: string, cmd: UiCommand) => CommandOutcome; failSpeech?: { on: boolean } } = {}) {
  const store = await sharedStore;
  const sessionId = randomUUID();
  await store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  let t = T0;
  const clock = () => t;
  const sent: StageEvent[] = [];
  const runtime = createRuntime({ store, clock, channel: { send: (_id, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } });
  const inner = Array.isArray(portOrScript) ? createFakePort(portOrScript) : portOrScript;
  const requests: RunToolsRequest[] = [];
  const port: ModelPort = { runTools(req) { requests.push(req); return inner.runTools(req); } };
  const handoffs: Handoff[] = [];
  const handoffHooks: ((h: Handoff) => void)[] = [];
  const lateAgrees: { conflictId: string; winner: string; lineId: number }[] = [];
  const buildLoop: { handoff(sid: string, h: Handoff): void; taken?(sid: string): Promise<void> | null; lateAgree?(sid: string, a: { conflictId: string; winner: "A" | "B" | "C"; lineId: number }): Promise<boolean> } =
    {
      handoff: (_sid: string, h: Handoff) => { handoffs.push(h); for (const f of handoffHooks) f(h); },
      lateAgree: async (_sid, a) => { lateAgrees.push(a); return true; },
    };
  const said: string[] = [];
  const stops: string[] = [];
  const speech: Speech = { say: async (_sid, text) => { if (opts.failSpeech?.on) throw new Error("speech down"); said.push(text); return `u${said.length}`; }, stop: (sid) => { stops.push(sid); }, speaking: () => false };
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const loop = createConversationLoop({
    port, runtime, buildLoop, speech, store, clock, log: (msg, fields) => logs.push({ msg, fields }),
    ...(opts.uiCommand ? { uiCommand: opts.uiCommand } : {}),
  });
  const rt = runtime(sessionId);
  const say = async (speaker: string, text: string) => {
    const e = (await store.addEvent({ sessionId, recallMsgId: null, kind: "utterance", speaker, text }))!;
    loop.onUtterance(sessionId, { id: e.id, speaker, text });
    return e.id;
  };
  return {
    opts, store, sessionId, rt, loop, requests, buildLoop, lateAgrees, handoffs, handoffHooks, said, stops, logs, sent, say,
    advance: (ms: number) => { t += ms; return t; },
    now: () => t,
    mood: () => (rt.snapshot() as Snapshot).mood,
    userText: (i: number) => (requests[i].messages as { content: string }[]).map((m) => m.content).join("\n"),
    blocked: () => logs.filter((l) => l.msg === "speak.blocked"),
  };
}

const speak = (text: string, reason: string): ToolCall => ({ name: "speak", input: { text, reason } });
const updateBuild = (h: Handoff): ToolCall => ({ name: "update_build", input: h });

function handoff(groundingIds: number[], over: Partial<Handoff> = {}): Handoff {
  return {
    topics: [{ title: "Adding tasks", screenHint: "home", questionsRaised: [], proposals: [{ text: "Quick-add at top", proposedBy: "Amir", supporters: ["Sara"], objectors: [] }] }],
    mood: "converging", groundingIds, ...over,
  };
}

test("own utterances are ignored", async () => {
  const s = await setup([[speak("Sure.", "answer")]]);
  const own = await s.say("Builder", "Hey Builder, I am Builder?");
  await flush();
  assert.equal(s.requests.length, 0, "Builder's own line triggers no model call");
  assert.equal(s.mood(), "listening", "and is not treated as being addressed");
  s.loop.onPartial(s.sessionId, { speaker: "Builder", text: "hey builder" });
  assert.equal(s.mood(), "listening");

  await s.say("Amir", "Let's start with the task list.");
  await flush();
  assert.equal(s.requests.length, 1);
  assert.ok(!s.userText(0).includes(`[${own}]`), "Builder's transcribed line is not in the window");
  assert.ok(!s.userText(0).includes("I am Builder"));
});

test("addressing 'hey Builder' sets thinking mood before the model responds", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  assert.equal(s.mood(), "listening");
  s.loop.onPartial(s.sessionId, { speaker: "Sara", text: "hey builder what do" });
  assert.equal(s.mood(), "thinking", "reacts on the partial, synchronously");
  assert.equal(held.calls.length, 0, "no model call for a partial");

  await s.say("Sara", "Hey Builder, what do you think about a sidebar?");
  await flush();
  assert.equal(held.calls.length, 1);
  assert.equal(s.mood(), "thinking", "still thinking while the model call is in flight");
  await held.release(0, [speak("I'd skip it for now: three screens fit in tabs. Want tabs?", "answer")]);
  assert.deepEqual(s.said, ["I'd skip it for now: three screens fit in tabs. Want tabs?"]);
  assert.equal(s.mood(), "curious", "its line asked the room something");

  // A plain final with the name also reacts at once; the window is 8 s.
  const t = await setup(heldPort().port);
  await t.say("Amir", "builder, show settings");
  assert.equal(t.mood(), "thinking");
  t.advance(ADDRESSED_MS + 1);
  assert.equal(t.mood(), "listening");
});

test("speak without valid reason is blocked (silent by default)", async () => {
  const s = await setup([
    [speak("Nice idea!", "answer")],
    [speak("Hello!", "opening")],
    [speak("Anyone?", "stuck")],
    [speak("So: B. Everyone OK?", "confirm_conflict")],
    [speak("Done.", "command_feedback")],
  ]);
  for (let i = 0; i < 5; i++) {
    await s.say("Amir", `We could add tags, version ${i}.`);
    await flush();
  }
  assert.equal(s.requests.length, 5);
  assert.deepEqual(s.said, [], "nothing was said");
  assert.deepEqual(s.blocked().map((l) => l.fields?.reason), ["answer", "opening", "stuck", "confirm_conflict", "command_feedback"]);
  for (const l of s.blocked()) assert.ok(!JSON.stringify(l).includes("Nice idea"), "no spoken text in logs");

  // Allowed reason but two questions in one line: blocked too.
  const q = await setup([[speak("Tabs or a sidebar? Or both?", "answer")]]);
  await q.say("Sara", "Builder, what layout?");
  await flush();
  assert.deepEqual(q.said, []);
  assert.equal(q.blocked()[0].fields?.why, "too_many_questions");
});

test("opening speaks once after bot records with a human present", async () => {
  const opening = "I'm Builder: I'll listen and sketch, so just say my name. What's the app, and who's it for?";
  const s = await setup([[speak(opening, "opening")], [speak(opening, "opening")]]);
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.equal(s.requests.length, 0, "no human yet: no opening");

  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Builder" });
  await flush();
  assert.equal(s.requests.length, 0, "the bot joining is not a human");

  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  await flush();
  assert.equal(s.requests.length, 1);
  assert.match(s.userText(0), /opening/);
  assert.deepEqual(s.said, [opening]);

  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.equal(s.requests.length, 1, "the opening turn runs once per session");
  await s.say("Amir", "So, a todo app.");
  await flush();
  assert.deepEqual(s.said, [opening], "a second opening is blocked");
  assert.equal(s.blocked().at(-1)?.fields?.reason, "opening");
});

const FALLBACK_OPENING = "Hi, I'm Builder. I'll listen and sketch; say my name if you need me.";

test("opening falls back to the fixed line when the model throws", async () => {
  const s = await setup({ runTools: async () => { throw new Error("boom"); } });
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.deepEqual(s.said, [FALLBACK_OPENING]);
  assert.ok(s.logs.some((l) => l.msg === "conversation.opening_fallback"));
  assert.ok(!JSON.stringify(s.logs).includes("sketch"), "no content in logs");
  assert.equal(s.mood(), "listening", "the fixed line asks nothing");
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.deepEqual(s.said, [FALLBACK_OPENING], "still once per session");
});

test("opening falls back when the model stays silent", async () => {
  const s = await setup([[speak("Hello there!", "answer")], [speak("Hi again, I'm Builder. What's the app for?", "opening")]]);
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.deepEqual(s.said, [FALLBACK_OPENING], "no valid speak(opening): the fixed line is said");
  await s.say("Amir", "Okay, a todo app.");
  await flush();
  assert.deepEqual(s.said, [FALLBACK_OPENING], "opened: a later opening is blocked");
});

test("an opening longer than about five seconds is not said; the short fixed line is", async () => {
  const long = "Hi, I'm Builder: I'll mostly listen and sketch what you describe, so say my name if you need me. What's the app for, and who will use it?";
  assert.ok(long.length > OPENING_MAX && FALLBACK_OPENING.length <= OPENING_MAX);
  const s = await setup([[speak(long, "opening")]]);
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.deepEqual(s.said, [FALLBACK_OPENING]);
  assert.deepEqual(s.blocked().map((l) => [l.fields?.reason, l.fields?.why]), [["opening", "too_long"]]);
});

test("a failing store or runtime does not throw into the caller", async () => {
  const store = await testStore();
  const fail = async (): Promise<never> => { throw new Error("db is gone"); };
  const broken = { ...store, getSession: fail, listEvents: fail, addEvent: fail, addModelCall: fail } as typeof store;
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const runtime = () => { throw new Error("db is gone"); };
  const loop = createConversationLoop({
    port: createFakePort([]), runtime, store: broken, clock: () => T0, log: (msg, fields) => logs.push({ msg, fields }),
    buildLoop: { handoff() {} }, speech: { say: async () => "u", stop() {}, speaking: () => false },
  });
  const sid = randomUUID();
  assert.doesNotThrow(() => loop.onUtterance(sid, { id: 1, speaker: "Amir", text: "Hello?" }));
  assert.doesNotThrow(() => loop.onPartial(sid, { speaker: "Amir", text: "hey builder" }));
  assert.doesNotThrow(() => loop.onParticipant(sid, { kind: "join", name: "Amir" }));
  assert.doesNotThrow(() => loop.onBotRecording(sid));
  assert.doesNotThrow(() => loop.poll(T0));
  // After a restart, a store that can't be read leaves the session to start fresh, logged.
  await loop.resume(randomUUID());
  await flush();
  const failed = logs.filter((l) => l.msg === "conversation.entry_failed");
  assert.ok(failed.some((l) => l.fields?.entry === "onPartial"), "the runtime's failure is caught");
  assert.ok(failed.some((l) => l.fields?.entry === "resume"), "the store's failure is caught");
  for (const l of failed) assert.equal(l.fields?.error, "Error", "errors are logged by name only");
  assert.ok(!JSON.stringify(logs).includes("db is gone"));
  await store.close();
});

test("failing commands stop triggering follow-up turns after 2", async () => {
  const s = await setup(fnPort(() => [{ name: "ui_command", input: { action: "click", target: "Nope" } }]), {
    uiCommand: () => ({ ok: false, reason: "not_found" }),
  });
  await s.say("Amir", "Click nope.");
  await flush();
  assert.equal(s.requests.length, 3, "the utterance turn plus 2 follow-ups");
  assert.ok(s.logs.some((l) => l.msg === "conversation.command_followup_capped"));
  await s.say("Amir", "Try again, click nope.");
  await flush();
  assert.equal(s.requests.length, 6, "a new human utterance resets the cap");
});

// A port that decides each response when the call is made (ids are known only by then).
function fnPort(fn: (i: number, text: string) => ToolCall[]): ModelPort {
  let i = 0;
  return {
    async runTools(req) {
      await Promise.resolve(); // decide after the caller's synchronous code (e.g. say() returning the id)
      const text = (req.messages as { content: string }[]).map((m) => m.content).join("\n");
      const toolCalls = fn(i++, text);
      return { toolCalls, ms: 1, dropped: 0, stopReason: toolCalls.length ? "tool_use" : "end_turn", usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    },
  };
}

test("update_build forwards a schema-valid handoff with grounding ids to the build loop", async () => {
  const ids: Record<string, number> = {};
  const s = await setup(fnPort((i) => {
    if (i === 0) return [updateBuild(handoff([ids.amir, ids.builder, ids.foreign, 999_999]))];
    if (i === 1) return [updateBuild(handoff([ids.builder, 999_999]))];
    if (i === 2) return [updateBuild({ ...handoff([ids.amir]), mood: "bogus" } as unknown as Handoff)];
    return [];
  }));
  const other = randomUUID();
  await s.store.createIntent(other, "https://meet.google.com/xyz-abcd-efg");
  ids.foreign = (await s.store.addEvent({ sessionId: other, recallMsgId: null, kind: "utterance", speaker: "Eve", text: "Agreed." }))!.id;
  ids.builder = (await s.store.addEvent({ sessionId: s.sessionId, recallMsgId: null, kind: "utterance", speaker: "Builder", text: "Sounds good." }))!.id;
  s.loop.onUtterance(s.sessionId, { id: ids.builder, speaker: "Builder", text: "Sounds good." });
  // Stored first, then heard: the port reads ids.amir when the turn starts.
  ids.amir = (await s.store.addEvent({ sessionId: s.sessionId, recallMsgId: null, kind: "utterance", speaker: "Amir", text: "Quick-add at the top." }))!.id;
  s.loop.onUtterance(s.sessionId, { id: ids.amir, speaker: "Amir", text: "Quick-add at the top." });
  await flush();

  assert.equal(s.handoffs.length, 1);
  const h = s.handoffs[0];
  assert.ok(HandoffSchema.safeParse(h).success, "schema-valid");
  assert.deepEqual(h.groundingIds, [ids.amir], "only this session's human utterances ground a hand-off");
  assert.equal(h.topics[0].proposals[0].proposedBy, "Amir");

  // The transcript marks what has already been handed off.
  await s.say("Sara", "Yes, let's do that.");
  await flush();
  assert.ok(s.userText(1).includes(`handed_off_through="${ids.amir}"`));
  assert.equal(s.handoffs.length, 1, "a hand-off with no valid grounding is not forwarded");
  assert.ok(s.logs.some((l) => l.msg === "handoff.ungrounded"));

  await s.say("Sara", "And tags later.");
  await flush();
  assert.equal(s.handoffs.length, 1, "a schema-invalid hand-off is not forwarded");
});

// A one-tool-call Anthropic stream, as OpenRouter sends it.
function toolStream(name: string, input: unknown): typeof fetch {
  const events = [
    { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
}

// The slip seen live and in scripts/probe-handoff.ts (the settle-and-ask round, 3 of 3 runs): strict
// decoding is not enforced through OpenRouter, Haiku put requestedView inside a topic, and the port
// dropped the whole hand-off, resolvedChoice included.
test("update_build survives the observed slips (requestedView inside a topic, an unknown key) and stays strict elsewhere", async () => {
  const s = await setup([[]]);
  const id = await s.say("Maya", "Fine, option B. Can we see settings next?");
  await flush();
  const tool = (s.requests[0].tools as PortTool[]).find((t) => t.name === "update_build")!;
  const run = async (input: unknown) => {
    const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
    const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: toolStream("update_build", input), log: (msg, fields) => logs.push({ msg, fields }) });
    const r = await port.runTools({ loop: "conversation", system: "s", messages: [], tools: [tool], effort: "low" });
    return { r, logs, h: r.toolCalls[0]?.input as Handoff | undefined };
  };
  const settled = { title: "Progress view", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } };
  const settings = { title: "Settings", screenHint: "settings", proposals: [], questionsRaised: [] };
  const observed = { topics: [settled, { ...settings, requestedView: "settings" }], mood: "converging", groundingIds: [id] };

  const a = await run(observed);
  assert.equal(a.r.dropped, 0, "the observed hand-off is no longer dropped");
  assert.deepEqual(a.h, { topics: [settled, settings], mood: "converging", groundingIds: [id], requestedView: "settings" },
    "a topic's requestedView moves up to the hand-off, where the build loop reads it");

  const b = await run({ ...observed, requestedView: "home" });
  assert.equal(b.h?.requestedView, "home", "an explicit hand-off requestedView wins");
  assert.equal("requestedView" in b.h!.topics[1], false);

  const c = await run({ ...observed, topics: [settled], extraNote: "x" });
  assert.equal(c.r.dropped, 0, "an unknown key is stripped, not fatal");
  assert.equal("extraNote" in c.h!, false);
  const repaired = c.logs.find((l) => l.msg === "llm_tool_repaired");
  assert.deepEqual(repaired?.fields?.repairs, [{ path: "", code: "unrecognized_keys" }]);
  assert.ok(!JSON.stringify(c.logs).includes("extraNote"), "repairs log paths and codes only");

  // Ids, enums and types stay strict.
  for (const bad of [
    { ...observed, mood: "bogus" },
    { ...observed, topics: [{ ...settled, resolvedChoice: { conflictId: "c1", winner: "D" } }] },
    { ...observed, groundingIds: [1.5] },
    { ...observed, groundingIds: undefined },
    { ...observed, topics: [{ ...settings, proposals: undefined }] },
  ]) assert.equal((await run(bad)).r.dropped, 1, JSON.stringify(bad).slice(0, 80));
});

test("a topic's requestedView moves up: the hand-off's own wins, else the latest; a view not kept becomes its topic's screenHint", () => {
  const topic = (title: string, extra: Record<string, unknown> = {}) => ({ title, proposals: [], questionsRaised: [], ...extra });
  const base = { mood: "exploring", groundingIds: [1] };
  const two = [topic("Settings", { requestedView: "settings" }), topic("Profile", { requestedView: "profile" })];

  const latest = HandoffToolInput.parse({ ...base, topics: two });
  assert.equal(latest.requestedView, "profile", "the latest request wins, as when hand-offs merge");
  assert.deepEqual(latest.topics, [topic("Settings", { screenHint: "settings" }), topic("Profile")]);

  const own = HandoffToolInput.parse({ ...base, requestedView: "home", topics: two });
  assert.equal(own.requestedView, "home");
  assert.deepEqual(own.topics, [topic("Settings", { screenHint: "settings" }), topic("Profile", { screenHint: "profile" })]);

  // A topic keeps the screenHint it has.
  const hinted = HandoffToolInput.parse({ ...base, requestedView: "home", topics: [topic("Settings", { screenHint: "prefs", requestedView: "settings" })] });
  assert.deepEqual(hinted.topics, [topic("Settings", { screenHint: "prefs" })]);
});

test("context window is capped at 40 utterances", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  const ids = [await s.say("Amir", "line 0")];
  await flush();
  for (let i = 1; i < 50; i++) ids.push(await s.say(i % 2 ? "Sara" : "Amir", `line ${i}`));
  await held.release(0);
  assert.equal(held.calls.length, 2, "utterances during a call coalesce into one follow-up call");
  const text = (held.calls[1].req.messages as { content: string }[])[0].content;
  assert.equal(WINDOW, 40);
  const shown = ids.filter((id) => text.includes(`[${id}]`));
  assert.deepEqual(shown, ids.slice(-40), "the latest 40 utterances, nothing older");
  assert.ok(text.includes("line 49"));
  await held.release(1);
});

test("model calls use Haiku at low effort with strict tools and are cost-recorded", async () => {
  const s = await setup([[]]);
  await s.say("Amir", "Hello everyone.");
  await flush();
  const req = s.requests[0];
  assert.equal(req.loop, "conversation");
  assert.equal(MODELS[req.loop], "anthropic/claude-haiku-5.5");
  assert.equal(req.effort, "low");
  assert.equal("tool_choice" in req, false);
  const tools = req.tools as { name: string; strict?: boolean; input_schema: Record<string, unknown> }[];
  assert.deepEqual(tools.map((t) => t.name).sort(), ["speak", "ui_command", "update_build"]);
  for (const t of tools) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
  }
  const calls = await s.store.listModelCalls(s.sessionId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].loop, "conversation");
  assert.equal(calls[0].model, "anthropic/claude-haiku-5.5");
});

test("an answer is spoken once per address; human speech clears the question mood", async () => {
  const s = await setup([[speak("Tabs. Want them?", "answer")], [speak("Tabs again.", "answer")]]);
  await s.say("Sara", "Builder, tabs or sidebar?");
  await flush();
  assert.deepEqual(s.said, ["Tabs. Want them?"]);
  assert.equal(s.mood(), "curious");
  await s.say("Amir", "Tabs it is.");
  await flush();
  assert.deepEqual(s.said, ["Tabs. Want them?"], "the same address is not answered twice");
  assert.equal(s.mood(), "listening", "a human utterance clears lastSpeechWasQuestion");
});

const conflictDoc = (): ConsensusDoc => ({
  ...emptyDoc(),
  conflicts: [{
    id: "c1", topic: "Where done tasks go", status: "open", openedAt: T0,
    variants: [
      { label: "A", summary: "Hide done tasks behind a toggle", backers: ["Amir"], batch: { label: "A", ops: [] } },
      { label: "B", summary: "Move done tasks to a Done tab", backers: ["Sara"], batch: { label: "B", ops: [] } },
    ],
  }],
});

test("confirm_conflict speaks only within 10 s of a conflict resolving", async () => {
  const s = await setup(fnPort((i, text) => {
    const confirm = speak("So: B. Everyone OK?", "confirm_conflict");
    if (i !== 1) return [confirm];
    const ids = [...text.matchAll(/\[(\d+)\] Sara/g)].map((m) => Number(m[1]));
    // Speak listed first on purpose: hand-offs still run before speech.
    return [confirm, updateBuild(handoff(ids, { topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }] }))];
  }));
  s.rt.setDoc(conflictDoc());
  // The fake build loop resolves the way the real one does: synchronously, inside handoff().
  s.handoffHooks.push((h) => { const c = h.topics[0]?.resolvedChoice; if (c) s.rt.resolveComparison(c.conflictId, c.winner); });

  await s.say("Amir", "Hmm, not sure.");
  await flush();
  assert.deepEqual(s.said, [], "no resolution yet");

  await s.say("Sara", "Let's go with B.");
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"], "update_build runs before speak, so the fresh resolution counts");

  s.advance(3_000);
  await s.say("Amir", "Fine by me.");
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"], "one confirmation per resolution");
});

test("a pick the build loop resolves only after reading the store still opens confirm_conflict in the same turn", async () => {
  const s = await setup(fnPort((i, text) => {
    if (i !== 1) return [];
    const ids = [...text.matchAll(/\[(\d+)\] Sara/g)].map((m) => Number(m[1]));
    return [speak("So: B. Everyone OK?", "confirm_conflict"),
      updateBuild(handoff(ids, { topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }] }))];
  }));
  s.rt.setDoc(conflictDoc());
  // As the real build loop does with a pick: the grounding lines are read first, so the conflict resolves later.
  let taken: Promise<void> | null = null;
  s.buildLoop.taken = () => taken;
  s.handoffHooks.push((h) => {
    const c = h.topics[0]?.resolvedChoice;
    if (c) taken = new Promise<void>((r) => setTimeout(r, 20)).then(() => { s.rt.resolveComparison(c.conflictId, c.winner); });
  });

  await s.say("Amir", "Hmm, not sure.");
  await flush();
  await s.say("Sara", "Let's go with B.");
  await flush();
  await taken;
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"], "the gate waited for the pick to be taken");
  assert.deepEqual(s.blocked(), []);
});

for (const streamed of [true, false]) test(`a command in the same turn as a pick runs against the merged winner, even when the pick waits for the store (${streamed ? "streamed" : "after the turn"})`, async () => {
  // Variant B adds the Done tab; the room picks B and asks to open it, in one turn.
  const doc = conflictDoc();
  doc.conflicts[0].variants[1].batch = { label: "B", ops: [{ op: "add", parentId: "home", node: { id: "home.done-tab", type: "Button", props: { label: "Done" }, status: "draft", children: [] } }] };
  const ran: boolean[] = [];
  const ref: { rt?: { snapshot(): unknown } } = {};
  const script = fnPort((i, text) => {
    if (i !== 1) return [];
    const ids = [...text.matchAll(/\[(\d+)\] Sara/g)].map((m) => Number(m[1]));
    return [
      updateBuild(handoff(ids, { topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }] })),
      { name: "ui_command", input: { action: "click", target: "Done" } },
    ];
  });
  // Streamed: the calls take effect as they arrive, through onToolCall. Otherwise apply() handles them.
  const port: ModelPort = streamed
    ? { async runTools(req) { const r = await script.runTools(req); for (const c of r.toolCalls) req.onToolCall?.(c); return r; } }
    : script;
  const s = await setup(port, {
    uiCommand: () => {
      const there = !!findNode((ref.rt!.snapshot() as Snapshot).proto, "home.done-tab");
      ran.push(there);
      return there ? { ok: true, visible: true } : { ok: false, reason: "not_found" };
    },
  });
  ref.rt = s.rt;
  s.rt.setDoc(doc);
  // As the real build loop does with a pick: the grounding lines are read first, so the winner merges later.
  let taken: Promise<void> | null = null;
  s.buildLoop.taken = () => taken;
  s.handoffHooks.push((h) => {
    const c = h.topics[0]?.resolvedChoice;
    if (c) taken = new Promise<void>((r) => setTimeout(r, 20)).then(() => { s.rt.resolveComparison(c.conflictId, c.winner); taken = null; });
  });

  await s.say("Amir", "Hmm, not sure.");
  await flush();
  await s.say("Sara", "Let's go with B, open Done.");
  await flush();
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  assert.deepEqual(ran, [true], "the command ran once, after B was merged");
  assert.ok(s.logs.some((l) => l.msg === "conversation.command" && l.fields?.ok === true));
});

test("a failed voice command gets a follow-up turn where command_feedback may speak", async () => {
  const commands: UiCommand[] = [];
  const seen: string[] = [];
  const s = await setup(fnPort((i, text) => {
    seen.push(text);
    if (i === 0) return [{ name: "ui_command", input: { action: "click", target: "Add" } }];
    if (i === 1) return [speak("The Add button or Add list?", "command_feedback")];
    return [speak("Done.", "command_feedback")];
  }), { uiCommand: (_sid, cmd) => { commands.push(cmd); return { ok: false, reason: "ambiguous", candidates: ["Add button", "Add list"] }; } });
  await s.say("Amir", "Click Add.");
  await flush();
  assert.deepEqual(commands, [{ action: "click", target: "Add" }]);
  assert.equal(s.requests.length, 2, "the result is shown to the model in a follow-up turn");
  assert.match(seen[1], /ambiguous/);
  assert.match(seen[1], /Add list/);
  assert.deepEqual(s.said, ["The Add button or Add list?"]);

  s.advance(6_000);
  await s.say("Amir", "Never mind.");
  await flush();
  assert.deepEqual(s.said, ["The Add button or Add list?"], "feedback only within 5 s of the command, once");
});

test("a stuck event from poll runs one turn where stuck may speak", async () => {
  const s = await setup([
    [], // the opening turn: the model stays silent, so the fixed opening is said
    [speak("I'd start with who uses it. Just you, or a team?", "answer")],
    [speak("Maybe start smaller: is this for one person?", "stuck")],
    [speak("Anyone?", "stuck")],
  ]);
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.deepEqual(s.said, [FALLBACK_OPENING]);
  const before = s.requests.length;
  // Builder asks the room something (here while answering an address).
  await s.say("Amir", "Builder, where do we start?");
  await flush();
  assert.equal(s.said.length, 2);
  const calls = s.requests.length;
  assert.equal(calls, before + 1);

  s.loop.poll(s.advance(19_000));
  await flush();
  assert.equal(s.requests.length, calls, "not stuck yet");
  s.loop.poll(s.advance(1_000));
  await flush();
  assert.equal(s.requests.length, calls + 1);
  assert.match(s.userText(calls), /stuck/);
  assert.deepEqual(s.said.slice(2), ["Maybe start smaller: is this for one person?"]);

  s.loop.poll(s.advance(30_000));
  await flush();
  assert.equal(s.requests.length, calls + 1, "cooldown: no second stuck turn");
});

// ---------- being addressed (known issue M4) ----------
test("'form builder' is not Builder's name, and a question right after Builder's line is a follow-up it may answer", async () => {
  const s = await setup([
    [speak("Nobody asked.", "answer")],
    [speak("Tabs keep it simple. Want tabs?", "answer")],
    [speak("Fewer taps on a phone.", "answer")],
    [speak("Sure.", "answer")],
    [speak("Dark mode can wait.", "answer")],
  ]);
  await s.say("Amir", "We need a form builder for the survey, like a page builder?");
  await flush();
  assert.equal(s.mood(), "listening", "not addressed");
  assert.match(s.userText(0), /<speaking_allowed>none<\/speaking_allowed>/);
  await s.say("Sara", "Builder, tabs or a sidebar?");
  await flush();
  s.advance(5_000);
  await s.say("Sara", "Why?");
  assert.equal(s.mood(), "thinking", "a follow-up reacts at once, like the name");
  await flush();
  assert.deepEqual(s.said, ["Tabs keep it simple. Want tabs?", "Fewer taps on a phone."]);
  // Only the first thing said after Builder's line, and only a question, is a follow-up.
  await s.say("Amir", "Okay.");
  await flush();
  await s.say("Amir", "And dark mode?");
  await flush();
  assert.deepEqual(s.said.length, 2);
  assert.deepEqual(s.blocked().map((l) => l.fields?.why), ["reason_not_open", "reason_not_open", "reason_not_open"]);

  // A question long after Builder's line is for the room.
  const t = await setup([[speak("Tabs. Want them?", "answer")], [speak("Because.", "answer")]]);
  await t.say("Sara", "Builder, which layout?");
  await flush();
  t.advance(FOLLOW_UP_MS + 1);
  await t.say("Sara", "Why?");
  await flush();
  assert.deepEqual(t.said, ["Tabs. Want them?"]);
});

// ---------- after a restart (known issue M2) ----------
test("after a restart, resume() reloads the transcript window as already handed off, and the opening stays done", async () => {
  const s = await setup([[], []]);
  await s.store.markCreated(s.sessionId, "bot-1");
  await s.store.updateBotStatus(s.sessionId, "in_call_recording", null);
  const add = async (speaker: string, text: string | null, kind = "utterance") => (await s.store.addEvent({ sessionId: s.sessionId, recallMsgId: null, kind, speaker, text }))!.id;
  await add("Maya", null, "join");
  await add("Ola", null, "join");
  const amir = await add("Amir", "Quick-add at the top.");
  await add("Builder", "Got it.");
  await add("Ola", null, "leave");
  const sara = await add("Sara", "Yes, and tags later.");
  await s.loop.resume(s.sessionId);
  await s.say("Lee", "And due dates.");
  await flush();
  assert.equal(s.requests.length, 1, "no second opening");
  const text = s.userText(0);
  assert.match(text, /<trigger>utterance<\/trigger>/);
  assert.ok(text.includes(`[${amir}] Amir: Quick-add at the top.`) && text.includes(`[${sara}] Sara: Yes, and tags later.`));
  assert.ok(!text.includes("Got it."), "Builder's transcribed line is not in the window");
  assert.ok(text.includes(`handed_off_through="${sara}"`), "reloaded lines count as handed off");
  assert.match(text, /<people>Maya, Amir, Sara, Lee<\/people>/, "who joined and has not left, and who spoke");
  assert.ok(s.logs.some((l) => l.msg === "conversation.resumed" && l.fields?.lines === 2 && l.fields?.people === 3));
});

// ---------- end of the call (known issue I5) ----------
test("after the bot leaves, Builder stops talking and nothing it hears, no stuck check and no late result makes it act", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  s.loop.onBotRecording(s.sessionId);
  await flush();
  assert.equal(held.calls.length, 1, "the opening turn is in flight");
  await s.say("Amir", "Builder, where do we start?");
  await flush();

  s.loop.onBotEnded(s.sessionId);
  assert.deepEqual(s.stops, [s.sessionId], "speech is cut");
  await held.release(0, [speak("Hi, I'm Builder. What's the app for?", "opening")]);
  assert.deepEqual(s.said, [], "the late opening is discarded, and no fallback line is said");
  assert.ok(s.logs.some((l) => l.msg === "conversation.turn_discarded"));

  await s.say("Amir", "Is anyone there?");
  s.loop.onPartial(s.sessionId, { speaker: "Amir", text: "hey builder" });
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Sara" });
  s.loop.onBotRecording(s.sessionId);
  s.loop.poll(s.advance(600_000));
  await flush();
  assert.equal(held.calls.length, 1, "no model call after the call ended");
  assert.deepEqual(s.said, []);
});

// ---------- model deadlines (known issue I1) ----------
test("a model call that stalls past its deadline frees the loop: the next utterance runs a turn", async () => {
  let fetches = 0;
  const silent = toolStream("speak", { text: "unused", reason: "answer" });
  const fetchFn = (async (url: any, init: any) => {
    fetches++;
    // The first call's body never ends and ignores the abort signal.
    if (fetches === 1) return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "text/event-stream" } });
    return silent(url, init);
  }) as typeof fetch;
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: fetchFn, deadlineMs: { conversation: 50 } });
  const s = await setup(port);
  await s.say("Amir", "Let's start with the task list.");
  await flush();
  assert.equal(fetches, 1);
  await new Promise((r) => setTimeout(r, 150)); await settle();
  await flush();
  assert.ok(s.logs.some((l) => l.msg === "conversation.turn_failed" && l.fields?.error === "LlmTimeoutError"));
  await s.say("Sara", "And due dates.");
  await new Promise((r) => setTimeout(r, 50)); await settle();
  await flush();
  assert.equal(fetches, 2, "the loop is not wedged by the stalled call");
});

test("chat speech posts the line to meeting chat and flags an agent caption without its text", async () => {
  const store = await testStore();
  const sessionId = randomUUID();
  await store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  await store.markCreated(sessionId, "bot-1");
  const sent: StageEvent[] = [];
  const runtime = createRuntime({ store, channel: { send: (_id, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } });
  const chats: { botId: string; message: string }[] = [];
  const recall = { sendChatMessage: async (botId: string, message: string) => { chats.push({ botId, message }); } };
  const speech = createChatSpeech({ recall, runtime, store });
  const id = await speech.say(sessionId, "x".repeat(600));
  assert.equal(typeof id, "string");
  assert.equal(chats.length, 1);
  assert.equal(chats[0].botId, "bot-1");
  assert.equal(chats[0].message.length, 500, "Google Meet chat limit");
  const caption = sent.find((e) => e.type === "caption");
  assert.ok(caption && caption.type === "caption");
  assert.deepEqual(caption.caption, { partial: false, isAgent: true }, "the stage never gets the line");
  assert.equal(speech.speaking(sessionId), false);
  speech.stop(sessionId);
});

// ---------- app wiring ----------
const SECRET = "whsec_" + Buffer.from("unit-test-secret").toString("base64");
const servers = new Set<http.Server>();
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });
const appConfig = () => loadConfig({ RECALL_REGION: "us-west-2", RECALL_API_KEY: "k", RECALL_WEBHOOK_VERIFICATION_SECRET: SECRET, PUBLIC_API_BASE_URL: "https://agent.example.com" });

test("the app forwards realtime events to the loop and bot recording triggers the opening", async () => {
  const config = appConfig();
  const chats: string[] = [];
  const fakeRecall: typeof fetch = async (input, init) => {
    const u = String(input);
    if (u.endsWith("/bot/")) return Response.json({ id: "bot-1" }, { status: 201 });
    if (u.endsWith("/send_chat_message/")) { chats.push(JSON.parse(String(init?.body)).message); return Response.json({}); }
    return Response.json({ id: "bot-1", status_changes: [{ code: "in_call_recording", sub_code: null, message: null, created_at: "" }] });
  };
  const store = await testStore();
  const requests: RunToolsRequest[] = [];
  const inner = createFakePort([[speak("Hi, I'm Builder. What's the app for?", "opening")], []]);
  const port: ModelPort = { runTools(req) { requests.push(req); return inner.runTools(req); } };
  const app = await createApp({
    config, store, log: () => {}, indexHtml: "", stageHtml: "",
    recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeRecall, sleep: async () => {} }),
    agent: { port },
  });
  const server = http.createServer(app.handler);
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const created = await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: "https://meet.google.com/abc-defg-hij" }) });
  const { session } = (await created.json()) as { session: { id: string } };

  // The request goes through a real socket; then whatever it started in the store gets to finish.
  const wait = async () => { await new Promise((r) => setTimeout(r, 30)); await settle(); };
  const deliver = async (event: string, data: Record<string, unknown>, msgId: string) => {
    const payload = JSON.stringify({ event, data: { bot: { id: "bot-1", metadata: { session_id: session.id } }, data } });
    const res = await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: signForTest(SECRET, payload, msgId) });
    assert.equal(res.status, 200);
    await wait();
  };
  await deliver("participant_events.join", { participant: { name: "Ada" } }, "m1");
  await app.pollOnce();
  await wait();
  assert.equal(requests.length, 1, "opening turn");
  assert.deepEqual(chats, ["Hi, I'm Builder. What's the app for?"]);

  await deliver("transcript.data", { participant: { name: "Ada" }, words: [{ text: "A" }, { text: "todo" }, { text: "app." }] }, "m2");
  assert.equal(requests.length, 2);
  const id = (await store.listEvents(session.id)).find((e) => e.kind === "utterance")!.id;
  assert.ok((requests[1].messages as { content: string }[])[0].content.includes(`[${id}] Ada: A todo app.`));
  app.tickAgent();
  server.close();
});

test("when the bot's status turns terminal the app ends the session: no more model calls (known issue I5)", async () => {
  const config = appConfig();
  let status = "in_call_recording";
  const fakeRecall: typeof fetch = async (input) => {
    const u = String(input);
    if (u.endsWith("/bot/")) return Response.json({ id: "bot-9" }, { status: 201 });
    if (u.endsWith("/send_chat_message/")) return Response.json({});
    return Response.json({ id: "bot-9", status_changes: [{ code: status, sub_code: null, message: null, created_at: "" }] });
  };
  const store = await testStore();
  const requests: RunToolsRequest[] = [];
  const inner = createFakePort([]);
  const port: ModelPort = { runTools(req) { requests.push(req); return inner.runTools(req); } };
  const logs: string[] = [];
  const app = await createApp({
    config, store, log: (m) => logs.push(m), indexHtml: "", stageHtml: "",
    recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: fakeRecall, sleep: async () => {} }),
    agent: { port },
  });
  const server = http.createServer(app.handler);
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { session } = (await (await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: "https://meet.google.com/end-call-tst" }) })).json()) as { session: { id: string } };
  // The request goes through a real socket; then whatever it started in the store gets to finish.
  const wait = async () => { await new Promise((r) => setTimeout(r, 30)); await settle(); };
  const utter = async (msgId: string) => {
    const payload = JSON.stringify({ event: "transcript.data", data: { bot: { id: "bot-9", metadata: { session_id: session.id } }, data: { participant: { name: "Ada" }, words: [{ text: "hello" }] } } });
    await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: signForTest(SECRET, payload, msgId) });
    await wait();
  };
  await app.pollOnce();
  await utter("e1");
  const before = requests.length;
  assert.ok(before >= 1, "the agent runs during the call");

  status = "done";
  await app.pollOnce();
  assert.ok(logs.includes("session.ended") && logs.includes("conversation.ended") && logs.includes("build.ended"));
  await utter("e2");
  app.tickAgent();
  await wait();
  assert.equal(requests.length, before, "a late utterance costs nothing");
  assert.equal((await store.listEvents(session.id)).filter((e) => e.kind === "utterance").length, 2, "late events are still stored");
  server.close();
});

test("a restarted app picks up a call still recording: the window is reloaded and pending decisions tick again (known issue M2)", async () => {
  const config = appConfig();
  const store = await testStore();
  const id = randomUUID();
  await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  await store.markCreated(id, "bot-7");
  await store.updateBotStatus(id, "in_call_recording", null);
  const earlier = (await store.addEvent({ sessionId: id, recallMsgId: null, kind: "utterance", speaker: "Ada", text: "A todo app." }))!.id;
  const requests: RunToolsRequest[] = [];
  const inner = createFakePort([[]]);
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const app = await createApp({
    config, store, log: (msg, fields) => logs.push({ msg, fields }), indexHtml: "", stageHtml: "",
    recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: async () => Response.json({}), sleep: async () => {} }),
    agent: { port: { runTools(req) { requests.push(req); return inner.runTools(req); } } },
  });
  assert.ok(logs.some((l) => l.msg === "conversation.resumed" && l.fields?.session_id === id && l.fields?.lines === 1));
  const server = http.createServer(app.handler);
  servers.add(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const payload = JSON.stringify({ event: "transcript.data", data: { bot: { id: "bot-7", metadata: { session_id: id } }, data: { participant: { name: "Bo" }, words: [{ text: "For" }, { text: "teams." }] } } });
  await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: signForTest(SECRET, payload, "r1") });
  await new Promise((r) => setTimeout(r, 30)); await settle();
  assert.equal(requests.length, 1);
  assert.ok((requests[0].messages as { content: string }[])[0].content.includes(`[${earlier}] Ada: A todo app.`));
  server.close();
});

test("without agent deps the app stays listen-only", async () => {
  const config = appConfig();
  const app = await createApp({ config, store: await testStore(), log: () => {}, indexHtml: "", stageHtml: "", recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: async () => Response.json({}) }) });
  app.tickAgent();
});


test("a streamed update_build reaches the build loop before the turn ends", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  const id = await s.say("Amir", "Let's add a quick-add bar.");
  await flush();
  const call = updateBuild(handoff([id]));
  held.calls[0].req.onToolCall!(call);
  await flush();
  assert.equal(s.handoffs.length, 1, "forwarded while the model call is still held");
  await held.release(0, [call]);
  assert.equal(s.handoffs.length, 1, "the same call is not forwarded again after the turn");
  const turn = s.logs.find((l) => l.msg === "conversation.turn")!;
  assert.equal(turn.fields!.handoffs, 1);
});

test("a streamed ui_command runs before the turn ends, once", async () => {
  const held = heldPort();
  let ran = 0;
  const s = await setup(held.port, { uiCommand: () => { ran++; return { ok: true, visible: true }; } });
  await s.say("Amir", "Builder, click save.");
  await flush();
  const call: ToolCall = { name: "ui_command", input: { action: "click", target: "Save" } };
  held.calls[0].req.onToolCall!(call);
  assert.equal(ran, 1, "ran while the model call is still held");
  await held.release(0, [call]);
  assert.equal(ran, 1);
  const turn = s.logs.find((l) => l.msg === "conversation.turn")!;
  assert.equal(turn.fields!.commands, 1);
});

test("speak still waits for the end of the turn and the gate", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  await s.say("Sara", "Builder, tabs or sidebar?");
  await flush();
  const call = speak("Tabs. Want them?", "answer");
  held.calls[0].req.onToolCall!(call);
  await flush();
  assert.deepEqual(s.said, [], "nothing said while the turn streams");
  await held.release(0, [call]);
  assert.deepEqual(s.said, ["Tabs. Want them?"]);
});

test("conversation.turn logs queued_ms and handoff_ms", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  await s.say("Amir", "First thing.");
  await flush();
  const id = await s.say("Sara", "And a second thing.");
  s.advance(700);
  await held.release(0);
  assert.equal(held.calls.length, 2, "the queued utterance runs a follow-up turn");
  held.calls[1].req.onToolCall!(updateBuild(handoff([id])));
  await held.release(1);
  const turns = s.logs.filter((l) => l.msg === "conversation.turn");
  assert.equal(turns[0].fields!.queued_ms, 0);
  assert.equal(turns[0].fields!.handoff_ms, null);
  assert.ok((turns[1].fields!.queued_ms as number) >= 700);
  assert.equal(typeof turns[1].fields!.handoff_ms, "number");
});

test("a hand-off that streams in after the call ended is not forwarded", async () => {
  const { port, calls, release } = heldPort();
  const s = await setup(port);
  const id = await s.say("Amir", "Let's add a quick-add box at the top.");
  await flush();
  s.loop.onBotEnded(s.sessionId);
  calls[0].req.onToolCall?.(updateBuild(handoff([id])));
  await release(0, [updateBuild(handoff([id]))]);
  assert.equal(s.handoffs.length, 0);
});

// A comparison on screen with options A and B, as the runtime shows it.
function showAB(rt: ReturnType<typeof createRuntime> extends (id: string) => infer R ? R : never) {
  const variant = (label: string) => ({ label, summary: `Option ${label}`, backers: [], proto: { screens: [] } as never, focusIds: [] });
  rt.showComparison({ conflictId: "c-top", topic: "Top", variants: [variant("A"), variant("B")] });
}

test("a spoken pick of a label on screen hands the pick to the build loop, grounded in that line", async () => {
  const s = await setup([[]]);
  showAB(s.rt);
  const id = await s.say("Omid Omidi", "let's go with B");
  assert.equal(s.handoffs.length, 1);
  assert.deepEqual(s.handoffs[0], {
    topics: [{ title: "Pick", task: "Merging option B", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-top", winner: "B" } }],
    mood: "converging", groundingIds: [id],
  });
  assert.deepEqual(s.logs.find((l) => l.msg === "conversation.spoken_pick")?.fields, { session_id: s.sessionId, conflict_id: "c-top", winner: "B" });
});

test("no spoken pick without a comparison, from the bot, or for a line that only asks to see an option", async () => {
  const s = await setup([[]]);
  await s.say("Omid Omidi", "let's go with B");
  assert.equal(s.handoffs.length, 0, "no comparison on screen");
  showAB(s.rt);
  await s.say("Builder", "let's go with B");
  await s.say("Omid Omidi", "show option B");
  assert.equal(s.handoffs.length, 0);
  assert.equal(s.logs.filter((l) => l.msg === "conversation.spoken_pick").length, 0);
});

test("a line that triggers a spoken pick still gets its normal model turn", async () => {
  const s = await setup([[speak("Going with B.", "answer")]]);
  showAB(s.rt);
  await s.say("Omid Omidi", "Builder, let's go with B");
  await flush();
  assert.equal(s.handoffs.length, 1);
  assert.equal(s.requests.length, 1, "the model is still called for that line");
});

// A pick on screen for conflict c1 (also in the doc), resolved by the fake build loop when it gets the hand-off.
function pickSetup(s: Awaited<ReturnType<typeof setup>>, resolves = true) {
  s.rt.setDoc(conflictDoc());
  const variant = (label: string) => ({ label, summary: `Option ${label}`, backers: [], proto: { screens: [] } as never, focusIds: [] });
  s.rt.showComparison({ conflictId: "c1", topic: "Where done tasks go", variants: [variant("A"), variant("B")] });
  let taken: Promise<void> | null = null;
  s.buildLoop.taken = () => taken;
  s.handoffHooks.push((h) => {
    const c = h.topics[0]?.resolvedChoice;
    if (c && resolves) taken = new Promise<void>((r) => setTimeout(r, 10)).then(() => { s.rt.resolveComparison(c.conflictId, c.winner); taken = null; });
  });
}

test("a spoken pick that resolves the conflict is confirmed out loud, once", async () => {
  const s = await setup([[], []]);
  pickSetup(s);
  await s.say("Sara", "let's go with B");
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"]);
  assert.deepEqual(s.logs.find((l) => l.msg === "conversation.confirm_spoken")?.fields, { session_id: s.sessionId, conflict_id: "c1", winner: "B" });
  assert.equal(JSON.stringify(s.logs).includes("Everyone OK"), false, "no spoken text in logs");
});

test("no spoken confirmation when the pick did not resolve anything", async () => {
  const s = await setup([[]]);
  pickSetup(s, false);
  await s.say("Sara", "let's go with B");
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  assert.deepEqual(s.said, []);
  const t = await setup([[]]);
  await t.say("Sara", "let's go with B");
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  assert.deepEqual(t.said, [], "no comparison on screen");
});

test("the model's own confirm_conflict for a resolution Builder already confirmed is not said again", async () => {
  const s = await setup([[], [speak("So: B. Everyone OK?", "confirm_conflict")]]);
  pickSetup(s);
  await s.say("Sara", "let's go with B");
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  await s.say("Amir", "Sounds fine to me.");
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"]);
});

test("a confirmation whose speech fails is not marked confirmed, so the model can still confirm it", async () => {
  const s = await setup([[], [speak("So: B. Everyone OK?", "confirm_conflict")]], { failSpeech: { on: true } });
  pickSetup(s);
  await s.say("Sara", "let's go with B");
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  assert.deepEqual(s.said, []);
  assert.equal(s.logs.some((l) => l.msg === "conversation.confirm_spoken"), false);
  s.opts.failSpeech!.on = false;
  await s.say("Amir", "Sounds fine to me.");
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"], "the model's own confirmation still opens");
});

// A port that reports a truncated stream (no completed tool call) for the calls in `cut`, else runs the script.
function cuttingPort(cut: number[], script: (i: number, text: string) => ToolCall[]): ModelPort {
  let i = 0;
  return {
    async runTools(req) {
      await Promise.resolve();
      const n = i++;
      const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
      if (cut.includes(n)) return { toolCalls: [], ms: 1, dropped: 1, stopReason: null, truncated: true, usage };
      const text = (req.messages as { content: string }[]).map((m) => m.content).join("\n");
      const toolCalls = script(n, text);
      return { toolCalls, ms: 1, dropped: 0, stopReason: "tool_use", truncated: false, usage };
    },
  };
}

test("a truncated conversation turn with no tool call is run again once, with the same lines", async () => {
  const s = await setup(cuttingPort([0], (_i, text) => {
    const ids = [...text.matchAll(/\[(\d+)\] Amir/g)].map((m) => Number(m[1]));
    return [updateBuild(handoff(ids))];
  }));
  await s.say("Amir", "Let's add a quick-add box at the top.");
  await flush();
  await flush();
  assert.equal(s.requests.length, 2, "exactly two model calls");
  assert.equal(s.handoffs.length, 1, "and one hand-off");
  assert.deepEqual(s.logs.find((l) => l.msg === "conversation.turn_retried")?.fields, { session_id: s.sessionId });
});

test("a second consecutive truncation is not retried again", async () => {
  const s = await setup(cuttingPort([0, 1, 2, 3], () => []));
  await s.say("Amir", "Let's add a quick-add box at the top.");
  await flush();
  await flush();
  assert.equal(s.requests.length, 2);
  assert.equal(s.logs.filter((l) => l.msg === "conversation.turn_retried").length, 1);
  assert.equal(s.handoffs.length, 0);
});

// c1 resolved with B by Mohammad just now, and no comparison on screen.
function resolvedSetup(s: Awaited<ReturnType<typeof setup>>) {
  s.rt.setDoc(conflictDoc());
  s.rt.resolveComparison("c1", "B", ["Mohammad"]);
}

test("a late agreement with a pick made seconds ago is passed to the build loop with the line id", async () => {
  const s = await setup([[]]);
  resolvedSetup(s);
  s.advance(6000);
  const id = await s.say("Amir", "Agreed, B it is");
  await flush();
  assert.deepEqual(s.lateAgrees, [{ conflictId: "c1", winner: "B", lineId: id }]);
  assert.equal(s.handoffs.length, 0, "no resolvedChoice hand-off");
  assert.deepEqual(s.logs.find((l) => l.msg === "conversation.late_agree")?.fields, { session_id: s.sessionId, decision_id: "d-c1" });
});

test("no late agreement after 20 s, for another label, from the bot, or when already agreed", async () => {
  const s = await setup([[]]);
  resolvedSetup(s);
  s.advance(5000);
  await s.say("Amir", "Agreed, A it is");
  await s.say("Builder", "B it is");
  await s.say("Mohammad", "B it is");
  s.advance(20_000);
  await s.say("Amir", "Agreed, B it is");
  await flush();
  assert.deepEqual(s.lateAgrees, []);
});

test("every recently resolved conflict is considered, not just the first", async () => {
  const s = await setup([[]]);
  const doc = conflictDoc();
  doc.conflicts.push({ ...doc.conflicts[0], id: "c2", variants: doc.conflicts[0].variants.map((v) => ({ ...v })) });
  s.rt.setDoc(doc);
  s.rt.resolveComparison("c1", "A", ["Mohammad"]);
  s.rt.resolveComparison("c2", "B", ["Mohammad"]);
  s.advance(3000);
  const id = await s.say("Amir", "B it is");
  await flush();
  assert.deepEqual(s.lateAgrees, [{ conflictId: "c2", winner: "B", lineId: id }]);
});

test("nothing is spoken when the call ends while a turn waits for a pick to be taken", async () => {
  const s = await setup(fnPort((i, text) => {
    if (i !== 1) return [];
    const ids = [...text.matchAll(/\[(\d+)\] Sara/g)].map((m) => Number(m[1]));
    return [speak("So: B. Everyone OK?", "confirm_conflict"),
      updateBuild(handoff(ids, { topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }] }))];
  }));
  s.rt.setDoc(conflictDoc());
  let taken: Promise<void> | null = null;
  s.buildLoop.taken = () => taken;
  s.handoffHooks.push((h) => {
    const c = h.topics[0]?.resolvedChoice;
    if (c) taken = new Promise<void>((r) => setTimeout(r, 20)).then(() => { s.rt.resolveComparison(c.conflictId, c.winner); taken = null; });
  });
  await s.say("Amir", "Hmm, not sure.");
  await flush();
  await s.say("Sara", "Let's go with B.");
  await flush();
  s.loop.onBotEnded(s.sessionId);
  await new Promise((r) => setTimeout(r, 40));
  await flush();
  assert.deepEqual(s.said, []);
});
