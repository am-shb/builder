import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createFakePort, MODELS } from "../src/agent/llm.ts";
import type { ModelPort, RunToolsRequest, RunToolsResult, ToolCall } from "../src/agent/llm.ts";
import { HandoffSchema } from "../src/agent/handoff.ts";
import type { Handoff } from "../src/agent/handoff.ts";
import { createChatSpeech, createConversationLoop, ADDRESSED_MS, WINDOW } from "../src/agent/conversation-loop.ts";
import type { CommandOutcome, Speech, UiCommand } from "../src/agent/conversation-loop.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { createApp, REALTIME_PATH } from "../src/app.ts";
import { signForTest } from "../src/verify.ts";

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };
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

function setup(portOrScript: ModelPort | ToolCall[][], opts: { uiCommand?: (sessionId: string, cmd: UiCommand) => CommandOutcome } = {}) {
  const store = openStore(":memory:");
  const sessionId = randomUUID();
  store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  let t = T0;
  const clock = () => t;
  const sent: StageEvent[] = [];
  const runtime = createRuntime({ store, clock, channel: { send: (_id, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } });
  const inner = Array.isArray(portOrScript) ? createFakePort(portOrScript) : portOrScript;
  const requests: RunToolsRequest[] = [];
  const port: ModelPort = { runTools(req) { requests.push(req); return inner.runTools(req); } };
  const handoffs: Handoff[] = [];
  const handoffHooks: ((h: Handoff) => void)[] = [];
  const buildLoop = { handoff: (_sid: string, h: Handoff) => { handoffs.push(h); for (const f of handoffHooks) f(h); } };
  const said: string[] = [];
  const speech: Speech = { say: async (_sid, text) => { said.push(text); return `u${said.length}`; }, stop() {}, speaking: () => false };
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const loop = createConversationLoop({
    port, runtime, buildLoop, speech, store, clock, log: (msg, fields) => logs.push({ msg, fields }),
    ...(opts.uiCommand ? { uiCommand: opts.uiCommand } : {}),
  });
  const rt = runtime(sessionId);
  const say = (speaker: string, text: string) => {
    const e = store.addEvent({ sessionId, recallMsgId: null, kind: "utterance", speaker, text })!;
    loop.onUtterance(sessionId, { id: e.id, speaker, text });
    return e.id;
  };
  return {
    store, sessionId, rt, loop, requests, handoffs, handoffHooks, said, logs, sent, say,
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
  const s = setup([[speak("Sure.", "answer")]]);
  const own = s.say("Builder", "Hey Builder, I am Builder?");
  await flush();
  assert.equal(s.requests.length, 0, "Builder's own line triggers no model call");
  assert.equal(s.mood(), "listening", "and is not treated as being addressed");
  s.loop.onPartial(s.sessionId, { speaker: "Builder", text: "hey builder" });
  assert.equal(s.mood(), "listening");

  s.say("Amir", "Let's start with the task list.");
  await flush();
  assert.equal(s.requests.length, 1);
  assert.ok(!s.userText(0).includes(`[${own}]`), "Builder's transcribed line is not in the window");
  assert.ok(!s.userText(0).includes("I am Builder"));
});

test("addressing 'hey Builder' sets thinking mood before the model responds", async () => {
  const held = heldPort();
  const s = setup(held.port);
  assert.equal(s.mood(), "listening");
  s.loop.onPartial(s.sessionId, { speaker: "Sara", text: "hey builder what do" });
  assert.equal(s.mood(), "thinking", "reacts on the partial, synchronously");
  assert.equal(held.calls.length, 0, "no model call for a partial");

  s.say("Sara", "Hey Builder, what do you think about a sidebar?");
  await flush();
  assert.equal(held.calls.length, 1);
  assert.equal(s.mood(), "thinking", "still thinking while the model call is in flight");
  await held.release(0, [speak("I'd skip it for now: three screens fit in tabs. Want tabs?", "answer")]);
  assert.deepEqual(s.said, ["I'd skip it for now: three screens fit in tabs. Want tabs?"]);
  assert.equal(s.mood(), "curious", "its line asked the room something");

  // A plain final with the name also reacts at once; the window is 8 s.
  const t = setup(heldPort().port);
  t.say("Amir", "builder, show settings");
  assert.equal(t.mood(), "thinking");
  t.advance(ADDRESSED_MS + 1);
  assert.equal(t.mood(), "listening");
});

test("speak without valid reason is blocked (silent by default)", async () => {
  const s = setup([
    [speak("Nice idea!", "answer")],
    [speak("Hello!", "opening")],
    [speak("Anyone?", "stuck")],
    [speak("So: B. Everyone OK?", "confirm_conflict")],
    [speak("Done.", "command_feedback")],
  ]);
  for (let i = 0; i < 5; i++) {
    s.say("Amir", `We could add tags, version ${i}.`);
    await flush();
  }
  assert.equal(s.requests.length, 5);
  assert.deepEqual(s.said, [], "nothing was said");
  assert.deepEqual(s.blocked().map((l) => l.fields?.reason), ["answer", "opening", "stuck", "confirm_conflict", "command_feedback"]);
  for (const l of s.blocked()) assert.ok(!JSON.stringify(l).includes("Nice idea"), "no spoken text in logs");

  // Allowed reason but two questions in one line: blocked too.
  const q = setup([[speak("Tabs or a sidebar? Or both?", "answer")]]);
  q.say("Sara", "Builder, what layout?");
  await flush();
  assert.deepEqual(q.said, []);
  assert.equal(q.blocked()[0].fields?.why, "too_many_questions");
});

test("opening speaks once after bot records with a human present", async () => {
  const opening = "Hi, I'm Builder: I'll mostly listen and sketch what you describe, so say my name if you need me. What's the app for, and who will use it?";
  const s = setup([[speak(opening, "opening")], [speak(opening, "opening")]]);
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
  s.say("Amir", "So, a todo app.");
  await flush();
  assert.deepEqual(s.said, [opening], "a second opening is blocked");
  assert.equal(s.blocked().at(-1)?.fields?.reason, "opening");
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
  const s = setup(fnPort((i) => {
    if (i === 0) return [updateBuild(handoff([ids.amir, ids.builder, ids.foreign, 999_999]))];
    if (i === 1) return [updateBuild(handoff([ids.builder, 999_999]))];
    if (i === 2) return [updateBuild({ ...handoff([ids.amir]), mood: "bogus" } as unknown as Handoff)];
    return [];
  }));
  const other = randomUUID();
  s.store.createIntent(other, "https://meet.google.com/xyz-abcd-efg");
  ids.foreign = s.store.addEvent({ sessionId: other, recallMsgId: null, kind: "utterance", speaker: "Eve", text: "Agreed." })!.id;
  ids.builder = s.store.addEvent({ sessionId: s.sessionId, recallMsgId: null, kind: "utterance", speaker: "Builder", text: "Sounds good." })!.id;
  s.loop.onUtterance(s.sessionId, { id: ids.builder, speaker: "Builder", text: "Sounds good." });
  ids.amir = s.say("Amir", "Quick-add at the top.");
  await flush();

  assert.equal(s.handoffs.length, 1);
  const h = s.handoffs[0];
  assert.ok(HandoffSchema.safeParse(h).success, "schema-valid");
  assert.deepEqual(h.groundingIds, [ids.amir], "only this session's human utterances ground a hand-off");
  assert.equal(h.topics[0].proposals[0].proposedBy, "Amir");

  // The transcript marks what has already been handed off.
  s.say("Sara", "Yes, let's do that.");
  await flush();
  assert.ok(s.userText(1).includes(`handed_off_through="${ids.amir}"`));
  assert.equal(s.handoffs.length, 1, "a hand-off with no valid grounding is not forwarded");
  assert.ok(s.logs.some((l) => l.msg === "handoff.ungrounded"));

  s.say("Sara", "And tags later.");
  await flush();
  assert.equal(s.handoffs.length, 1, "a schema-invalid hand-off is not forwarded");
});

test("context window is capped at 40 utterances", async () => {
  const held = heldPort();
  const s = setup(held.port);
  const ids = [s.say("Amir", "line 0")];
  await flush();
  for (let i = 1; i < 50; i++) ids.push(s.say(i % 2 ? "Sara" : "Amir", `line ${i}`));
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
  const s = setup([[]]);
  s.say("Amir", "Hello everyone.");
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
  const calls = s.store.listModelCalls(s.sessionId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].loop, "conversation");
  assert.equal(calls[0].model, "anthropic/claude-haiku-5.5");
});

test("an answer is spoken once per address; human speech clears the question mood", async () => {
  const s = setup([[speak("Tabs. Want them?", "answer")], [speak("Tabs again.", "answer")]]);
  s.say("Sara", "Builder, tabs or sidebar?");
  await flush();
  assert.deepEqual(s.said, ["Tabs. Want them?"]);
  assert.equal(s.mood(), "curious");
  s.say("Amir", "Tabs it is.");
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
  const s = setup(fnPort((i, text) => {
    const confirm = speak("So: B. Everyone OK?", "confirm_conflict");
    if (i !== 1) return [confirm];
    const ids = [...text.matchAll(/\[(\d+)\] Sara/g)].map((m) => Number(m[1]));
    // Speak listed first on purpose: hand-offs still run before speech.
    return [confirm, updateBuild(handoff(ids, { topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }] }))];
  }));
  s.rt.setDoc(conflictDoc());
  // The fake build loop resolves the way the real one does: synchronously, inside handoff().
  s.handoffHooks.push((h) => { const c = h.topics[0]?.resolvedChoice; if (c) s.rt.resolveComparison(c.conflictId, c.winner); });

  s.say("Amir", "Hmm, not sure.");
  await flush();
  assert.deepEqual(s.said, [], "no resolution yet");

  s.say("Sara", "Let's go with B.");
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"], "update_build runs before speak, so the fresh resolution counts");

  s.advance(3_000);
  s.say("Amir", "Fine by me.");
  await flush();
  assert.deepEqual(s.said, ["So: B. Everyone OK?"], "one confirmation per resolution");
});

test("a failed voice command gets a follow-up turn where command_feedback may speak", async () => {
  const commands: UiCommand[] = [];
  const seen: string[] = [];
  const s = setup(fnPort((i, text) => {
    seen.push(text);
    if (i === 0) return [{ name: "ui_command", input: { action: "click", target: "Add" } }];
    if (i === 1) return [speak("The Add button or Add list?", "command_feedback")];
    return [speak("Done.", "command_feedback")];
  }), { uiCommand: (_sid, cmd) => { commands.push(cmd); return { ok: false, reason: "ambiguous", candidates: ["Add button", "Add list"] }; } });
  s.say("Amir", "Click Add.");
  await flush();
  assert.deepEqual(commands, [{ action: "click", target: "Add" }]);
  assert.equal(s.requests.length, 2, "the result is shown to the model in a follow-up turn");
  assert.match(seen[1], /ambiguous/);
  assert.match(seen[1], /Add list/);
  assert.deepEqual(s.said, ["The Add button or Add list?"]);

  s.advance(6_000);
  s.say("Amir", "Never mind.");
  await flush();
  assert.deepEqual(s.said, ["The Add button or Add list?"], "feedback only within 5 s of the command, once");
});

test("a stuck event from poll runs one turn where stuck may speak", async () => {
  const s = setup([
    [], // the opening turn: the model stays silent
    [speak("I'd start with who uses it. Just you, or a team?", "answer")],
    [speak("Maybe start smaller: is this for one person?", "stuck")],
    [speak("Anyone?", "stuck")],
  ]);
  s.loop.onParticipant(s.sessionId, { kind: "join", name: "Amir" });
  s.loop.onBotRecording(s.sessionId);
  await flush();
  const before = s.requests.length;
  // Builder asks the room something (here while answering an address).
  s.say("Amir", "Builder, where do we start?");
  await flush();
  assert.equal(s.said.length, 1);
  const calls = s.requests.length;
  assert.equal(calls, before + 1);

  s.loop.poll(s.advance(19_000));
  await flush();
  assert.equal(s.requests.length, calls, "not stuck yet");
  s.loop.poll(s.advance(1_000));
  await flush();
  assert.equal(s.requests.length, calls + 1);
  assert.match(s.userText(calls), /stuck/);
  assert.deepEqual(s.said.slice(1), ["Maybe start smaller: is this for one person?"]);

  s.loop.poll(s.advance(30_000));
  await flush();
  assert.equal(s.requests.length, calls + 1, "cooldown: no second stuck turn");
});

test("chat speech posts the line to meeting chat and adds an agent caption", async () => {
  const store = openStore(":memory:");
  const sessionId = randomUUID();
  store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  store.markCreated(sessionId, "bot-1");
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
  assert.ok(caption && caption.type === "caption" && caption.caption.isAgent && caption.caption.speaker === "Builder");
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
  const store = openStore(":memory:");
  const requests: RunToolsRequest[] = [];
  const inner = createFakePort([[speak("Hi, I'm Builder. What's the app for?", "opening")], []]);
  const port: ModelPort = { runTools(req) { requests.push(req); return inner.runTools(req); } };
  const app = createApp({
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

  const settle = () => new Promise((r) => setTimeout(r, 30));
  const deliver = async (event: string, data: Record<string, unknown>, msgId: string) => {
    const payload = JSON.stringify({ event, data: { bot: { id: "bot-1", metadata: { session_id: session.id } }, data } });
    const res = await fetch(`${base}${REALTIME_PATH}`, { method: "POST", body: payload, headers: signForTest(SECRET, payload, msgId) });
    assert.equal(res.status, 200);
    await settle();
  };
  await deliver("participant_events.join", { participant: { name: "Ada" } }, "m1");
  await app.pollOnce();
  await settle();
  assert.equal(requests.length, 1, "opening turn");
  assert.deepEqual(chats, ["Hi, I'm Builder. What's the app for?"]);

  await deliver("transcript.data", { participant: { name: "Ada" }, words: [{ text: "A" }, { text: "todo" }, { text: "app." }] }, "m2");
  assert.equal(requests.length, 2);
  const id = store.listEvents(session.id).find((e) => e.kind === "utterance")!.id;
  assert.ok((requests[1].messages as { content: string }[])[0].content.includes(`[${id}] Ada: A todo app.`));
  app.tickAgent();
  server.close();
});

test("without agent deps the app stays listen-only", async () => {
  const config = appConfig();
  const app = createApp({ config, store: openStore(":memory:"), log: () => {}, indexHtml: "", stageHtml: "", recall: createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: async () => Response.json({}) }) });
  app.tickAgent();
});

