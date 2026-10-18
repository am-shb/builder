import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createFakePort } from "../src/agent/llm.ts";
import type { ModelPort, RunToolsRequest, RunToolsResult, ToolCall } from "../src/agent/llm.ts";
import { createBuildLoop, taskText, TASK_DONE_MS } from "../src/agent/build-loop.ts";
import { toolJsonSchema } from "../src/agent/tool-schema.ts";
import { enforceGrounding, HandoffSchema } from "../src/agent/handoff.ts";
import type { Handoff } from "../src/agent/handoff.ts";
import { findNode } from "../src/ui/tree.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { Prototype } from "../src/ui/schema.ts";

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };

// Manual clock and timers: nothing in these tests sleeps for real.
function fakeTimers(start = 1_700_000_000_000) {
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
      await flush();
    },
  };
}

// One database for the file: each test works in its own new session, and starting a database per test
// would cost more than the tests themselves.
const sharedStore = openStore();

async function setup(portOrScript: ModelPort | ToolCall[][]) {
  const store = await sharedStore;
  const sessionId = randomUUID();
  await store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  const timers = fakeTimers();
  const sent: StageEvent[] = [];
  const timeline: string[] = [];
  const runtime = createRuntime({
    store, clock: timers.now,
    channel: { send: (_id, ev) => { sent.push(ev); timeline.push(`ev:${ev.type}`); }, sendAudio() {}, clients: () => 0 },
  });
  const inner = Array.isArray(portOrScript) ? createFakePort(portOrScript) : portOrScript;
  const requests: RunToolsRequest[] = [];
  const port: ModelPort = {
    runTools(req) { requests.push(req); timeline.push("call"); return inner.runTools(req); },
  };
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  // Set faults.runtime to make every runtime lookup from the build loop throw.
  const faults = { runtime: false };
  const loopRuntime = (id: string) => {
    if (faults.runtime) throw new Error("runtime unavailable");
    return runtime(id);
  };
  const loop = createBuildLoop({ port, runtime: loopRuntime, store, clock: timers.now, log: (msg, fields) => logs.push({ msg, fields }), timers });
  const rt = runtime(sessionId);
  const snap = () => rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>;
  return {
    store, sessionId, timers, sent, timeline, requests, logs, loop, rt, faults,
    doc: (): ConsensusDoc => snap().doc,
    proto: (): Prototype => snap().proto,
    mood: () => snap().mood,
    say: async (speaker: string, text: string) => (await store.addEvent({ sessionId, recallMsgId: null, kind: "utterance", speaker, text }))!.id,
    patches: () => sent.filter((e): e is Extract<StageEvent, { type: "patch" }> => e.type === "patch"),
    userText: (i: number) => JSON.stringify(requests[i].messages),
  };
}

function handoff(groundingIds: number[], over: Partial<Handoff> = {}, title = "Adding tasks"): Handoff {
  return {
    topics: [{
      title, screenHint: "home", questionsRaised: [],
      proposals: [{ text: "Quick-add at top", proposedBy: "Amir", supporters: [], objectors: [] }],
    }],
    mood: "exploring", groundingIds, ...over,
  };
}

const patches = (label: string, ops: unknown[], by?: string): ToolCall => ({ name: "apply_patches", input: { label, ops, ...(by ? { by } : {}) } });
const consensus = (ops: unknown[]): ToolCall => ({ name: "update_consensus", input: { ops } });
const addNode = (parentId: string, id: string, type: string, props: [string, unknown][] = [], decisionId?: string) => ({
  op: "add", parentId,
  node: { id, type, props: props.map(([key, value]) => ({ key, value })), status: "draft", ...(decisionId ? { decisionId } : {}) },
});

const QUICK_ADD = [
  patches("Added: quick-add · Amir", [
    addNode("home", "home.quick-add", "Input", [["placeholder", "Add a task"]], "d-quick-add"),
    addNode("home", "home.quick-add-btn", "Button", [["label", "Add"]], "d-quick-add"),
  ], "Amir"),
];

const conflictVariant = (label: string, summary: string, backers: string[], ops: unknown[]) =>
  ({ label, summary, backers, batch: { label: `Option ${label}`, ops } });

const DONE_CONFLICT = consensus([{
  op: "add_conflict", id: "c-done", topic: "Where done tasks go",
  variants: [
    conflictVariant("A", "Hide done tasks behind a toggle", ["Amir"], [addNode("home", "home.show-done", "Toggle", [["label", "Show done"]])]),
    conflictVariant("B", "Move done tasks to a Done tab", ["Sara"], [addNode("home", "home.tabs", "Tabs", [["tabs", ["To do", "Done"]]])]),
  ],
}]);

// A port whose calls wait until released, to hold a run in flight.
function gatedPort(script: ToolCall[][]) {
  const fake = createFakePort(script);
  const gates: (() => void)[] = [];
  const port: ModelPort = {
    async runTools(req): Promise<RunToolsResult> {
      await new Promise<void>((r) => gates.push(r));
      return fake.runTools(req);
    },
  };
  return { port, release: () => gates.shift()?.() };
}

test("handoff → patches applied, decision added as draft→pending, doc and proto persisted", async () => {
  const s = await setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
    { op: "set_phase", phase: "explore" },
    { op: "set_next_up", items: ["Sara, should done tasks stay visible?"] },
    { op: "add_open_question", text: "Where do done tasks go?", raisedBy: "Sara" },
  ])]]);
  const g = await s.say("Amir", "Let's put a quick-add box right at the top of the list");
  s.loop.handoff(s.sessionId, handoff([g]));
  assert.equal(s.loop.idle(s.sessionId), false, "a run is in flight");
  await flush();

  // Request shape: build loop, low effort, two strict tools, grounding lines in the user turn.
  assert.equal(s.requests.length, 1);
  const req = s.requests[0];
  assert.equal(req.loop, "build");
  assert.equal(req.effort, "low");
  assert.ok(req.system.length > 500);
  const tools = req.tools as { name: string; strict?: boolean; input_schema: unknown }[];
  assert.deepEqual(tools.map((t) => t.name), ["apply_patches", "update_consensus"]);
  assert.ok(tools.every((t) => t.strict === true));
  assert.ok(s.userText(0).includes("quick-add box right at the top"), "grounding line text is sent to the model");
  assert.ok(s.userText(0).includes(`[${g}] Amir`), "grounding lines carry their id and speaker");

  assert.ok(findNode(s.proto(), "home.quick-add"));
  const d = s.doc().decisions.find((x) => x.id === "d-quick-add")!;
  assert.equal(d.status, "pending");
  assert.equal(d.proposedBy, "Amir");
  assert.equal(s.doc().phase, "explore");
  assert.deepEqual(s.doc().nextUp, ["Sara, should done tasks stay visible?"]);
  assert.equal(s.doc().openQuestions[0].text, "Where do done tasks go?");

  await s.rt.saved();
  const saved = (await s.store.getConsensus(s.sessionId))!;
  assert.equal(saved.doc.decisions[0].status, "pending");
  assert.ok(findNode(saved.proto, "home.quick-add-btn"));

  // Cost recorded through withCostRecording; mood went thinking and back.
  assert.equal((await s.store.listModelCalls(s.sessionId)).length, 1);
  const moods = s.sent.filter((e) => e.type === "mood").map((e) => (e as { mood: string }).mood);
  assert.ok(moods.includes("thinking"));
  assert.equal(s.mood(), "listening");
  assert.equal(s.loop.idle(s.sessionId), true);

  // Logs carry ids and counts only, never transcript text or model output.
  const logged = JSON.stringify(s.logs);
  assert.ok(!logged.includes("quick-add box"));
  assert.ok(!logged.includes("Quick-add at top"));
  assert.ok(s.logs.some((l) => l.msg === "build.run"));
});

test("streamed tool input shows the building mood and a pending region from the first add parentId", async () => {
  const fake = createFakePort([QUICK_ADD]);
  const s = await setup({
    async runTools(req) {
      for (const chunk of ['{"label":"Added: x","ops":[{"op":"add","pa', 'rentId":"ho', 'me","node":{"id":"a"}}', ',{"op":"add","parentId":"other"']) {
        req.onToolInputDelta?.("apply_patches", chunk);
      }
      return fake.runTools(req);
    },
  });
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add please")]));
  await flush();
  const regions = s.sent.filter((e): e is Extract<StageEvent, { type: "pending_region" }> => e.type === "pending_region").map((e) => e.parentId);
  assert.deepEqual(regions, ["home", null], "one region from the first parentId, cleared at the end");
  const moods = s.sent.filter((e) => e.type === "mood").map((e) => (e as { mood: string }).mood);
  assert.ok(moods.includes("building"));
  assert.equal(s.mood(), "listening");
});

test("support by a speaker not in grounding lines is dropped", async () => {
  const s = await setup([[consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: [] },
    { op: "mark_pending", decisionId: "d-quick-add" },
    { op: "support", decisionId: "d-quick-add", speaker: "Bob" },
    { op: "add_decision", id: "d-ghost", text: "Dark mode", proposedBy: "Bob", affects: [] },
  ])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick-add at the top"), await s.say("Sara", "hmm, maybe")]));
  await flush();
  const d = s.doc().decisions.find((x) => x.id === "d-quick-add")!;
  assert.equal(d.status, "pending", "Bob never spoke in the grounding lines");
  assert.deepEqual(d.agreedBy, []);
  assert.equal(s.doc().decisions.some((x) => x.id === "d-ghost"), false, "an ungrounded proposer is dropped");
  const run = s.logs.find((l) => l.msg === "build.run")!;
  assert.equal(run.fields?.grounding_dropped, 2);

  // The pure function: support/object/add_decision by a non-grounded speaker go, grounded ones stay.
  const r = enforceGrounding([
    { op: "support", decisionId: "d1", speaker: "Bob" },
    { op: "object", decisionId: "d1", speaker: "Bob" },
    { op: "add_decision", id: "d2", text: "x", proposedBy: "Bob", affects: [] },
    { op: "support", decisionId: "d1", speaker: "Sara" },
    { op: "mark_pending", decisionId: "d1" },
  ], new Set(["Amir", "Sara"]));
  assert.equal(r.dropped, 3);
  assert.deepEqual(r.ops.map((o) => o.op), ["support", "mark_pending"]);
});

test("handoffs during a run are merged into exactly one follow-up run", async () => {
  const g = gatedPort([[], [], []]);
  const s = await setup(g.port);
  const g1 = await s.say("Amir", "first line");
  const g2 = await s.say("Sara", "second line");
  const g3 = await s.say("Lee", "third line");
  s.loop.handoff(s.sessionId, handoff([g1], {}, "Topic one"));
  await flush();
  s.loop.handoff(s.sessionId, handoff([g2], {}, "Topic two"));
  s.loop.handoff(s.sessionId, handoff([g2, g3], { mood: "converging" }, "Topic three"));
  await flush();
  assert.equal(s.requests.length, 1, "single-flight: nothing starts while a run is in flight");

  g.release();
  await flush();
  await s.timers.advance(10_000);
  assert.equal(s.requests.length, 2);
  g.release();
  await flush();
  const second = s.userText(1);
  assert.ok(second.includes("Topic two") && second.includes("Topic three"), "topics concatenated");
  assert.ok(!second.includes("Topic one"));
  assert.ok(second.includes("second line") && second.includes("third line"), "grounding ids unioned");
  assert.equal(second.split("second line").length - 1, 1, "a grounding line appears once");

  await s.timers.advance(30_000);
  assert.equal(s.requests.length, 2, "exactly one follow-up run");
  assert.equal(s.loop.idle(s.sessionId), true);
});

test("3s floor between runs; resolvedChoice bypasses it", async () => {
  const s = await setup([[DONE_CONFLICT], [], [], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  await flush();
  assert.equal(s.requests.length, 1);
  assert.equal(s.doc().conflicts[0].status, "open");

  await s.timers.advance(1_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "something else")]));
  await flush();
  assert.equal(s.requests.length, 1, "within the floor");
  assert.equal(s.loop.idle(s.sessionId), false, "a run is scheduled");
  await s.timers.advance(1_500);
  assert.equal(s.requests.length, 1);
  await s.timers.advance(500);
  assert.equal(s.requests.length, 2, "runs once 3 s have passed since the last run started");

  await s.timers.advance(500);
  const before = s.timeline.length;
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "ok B")], {
    topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
  }));
  await flush();
  assert.equal(s.requests.length, 3, "a resolved conflict bypasses the floor");
  const after = s.timeline.slice(before);
  assert.ok(after.indexOf("ev:resolve") >= 0 && after.indexOf("ev:resolve") < after.indexOf("call"), "resolveComparison runs before the model call");
  assert.equal(s.doc().conflicts[0].status, "resolved");
});

test("invalid patch batch from model is rejected; screen unchanged; run still updates doc", async () => {
  const s = await setup([[
    patches("Added: orphan", [addNode("nope", "nope.child", "Text", [["text", "hi"]])]),
    patches("Added: bogus", [{ op: "explode", id: "home" }]),
    patches("Way too long a label for the stage to show without truncating it badly", [addNode("home", "home.x", "Text")]),
    consensus([{ op: "add_decision", id: "d-1", text: "Quick-add", proposedBy: "Amir", affects: [] }]),
  ]]);
  const before = s.proto();
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  assert.deepEqual(s.proto(), before, "screen unchanged");
  assert.equal(s.patches().length, 0, "nothing rendered");
  assert.equal(s.doc().decisions[0].id, "d-1", "doc still updated");
  const run = s.logs.find((l) => l.msg === "build.run")!;
  assert.equal(run.fields?.patches_rejected, 3);
  assert.equal(run.fields?.patches_applied, 0);
});

test("a refusal or zero valid calls leaves the screen and doc unchanged", async () => {
  const s = await setup({
    async runTools() {
      return { toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, ms: 1, stopReason: "refusal", dropped: 2 };
    },
  });
  const proto = s.proto();
  const doc = s.doc();
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  assert.deepEqual(s.proto(), proto);
  assert.deepEqual(s.doc(), doc);
  assert.equal(s.sent.filter((e) => e.type === "doc" || e.type === "patch").length, 0);
  const run = s.logs.find((l) => l.msg === "build.run")!;
  assert.equal(run.fields?.stop_reason, "refusal");
  assert.equal(run.fields?.dropped, 2);
  assert.equal((await s.store.listModelCalls(s.sessionId)).length, 1, "a refused call is still billed and recorded");
});

test("add_conflict shows comparison with ≥2 valid variants", async () => {
  const s = await setup([[DONE_CONFLICT]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  await flush();
  const views = s.sent.filter((e): e is Extract<StageEvent, { type: "comparison" }> => e.type === "comparison");
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].view!.variants.map((v) => v.label), ["A", "B"]);
  assert.equal(views[0].view!.conflictId, "c-done");
  assert.equal(findNode(s.proto(), "home.tabs"), undefined, "variants are not applied to the main prototype");
});

test("add_conflict with fewer than 2 applicable variants records the conflict but shows no comparison", async () => {
  const s = await setup([[consensus([{
    op: "add_conflict", id: "c-x", topic: "Where done tasks go",
    variants: [
      conflictVariant("A", "Toggle", ["Amir"], [addNode("home", "home.show-done", "Toggle")]),
      conflictVariant("B", "Tab", ["Sara"], [addNode("missing", "missing.tabs", "Tabs")]),
    ],
  }])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  await flush();
  assert.equal(s.sent.some((e) => e.type === "comparison"), false);
  assert.equal(s.doc().conflicts[0].id, "c-x");
  assert.ok(s.logs.some((l) => l.msg === "build.comparison_skipped" && l.fields?.conflict_id === "c-x"));
});

test("pending item auto-agrees after 30s and sets pleased mood", async () => {
  const s = await setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
  ])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
  await flush();
  await s.timers.advance(29_000);
  assert.equal(s.doc().decisions[0].status, "pending");
  await s.timers.advance(1_000);
  const d = s.doc().decisions[0];
  assert.equal(d.status, "agreed");
  assert.equal(typeof d.decidedAt, "number");
  assert.equal(s.mood(), "pleased");
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "agreed", "promotion flips the nodes");
  assert.ok(s.logs.some((l) => l.msg === "build.promoted" && l.fields?.via === "timeout"));
  await s.timers.advance(2_100);
  assert.equal(s.mood(), "listening", "pleased lasts 2 s");
});

test("agreed decision flips its affected nodes to status agreed via one batch", async () => {
  const s = await setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn", "home.gone"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
    { op: "support", decisionId: "d-quick-add", speaker: "Sara" },
  ])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top"), await s.say("Sara", "yes, love that")]));
  await flush();
  const d = s.doc().decisions[0];
  assert.equal(d.status, "agreed");
  assert.deepEqual(d.agreedBy, ["Sara"]);
  const flips = s.patches().filter((p) => p.changes[0]?.label.startsWith("Agreed: "));
  assert.equal(flips.length, 1, "one batch");
  assert.equal(flips[0].changes[0].label, "Agreed: Quick-add at top");
  assert.deepEqual(flips[0].changes.map((c) => [c.kind, c.id]), [["updated", "home.quick-add"], ["updated", "home.quick-add-btn"]], "missing ids skipped");
  for (const id of ["home.quick-add", "home.quick-add-btn"]) {
    const n = findNode(s.proto(), id)!;
    assert.equal(n.status, "agreed");
    assert.equal(n.decisionId, "d-quick-add");
  }
  assert.equal(s.mood(), "pleased");
});

test("resolving a conflict flips the winning variant's nodes to agreed", async () => {
  const s = await setup([[DONE_CONFLICT], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  await flush();
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "fine, B")], {
    topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
  }));
  await flush();
  const tabs = findNode(s.proto(), "home.tabs")!;
  assert.equal(tabs.status, "agreed");
  assert.equal(tabs.decisionId, "d-c-done");
  assert.equal(findNode(s.proto(), "home.show-done"), undefined, "the losing variant is not applied");
  const d = s.doc().decisions.find((x) => x.id === "d-c-done")!;
  assert.equal(d.status, "agreed");
  assert.deepEqual(d.affects, ["home.tabs"]);
  assert.equal(s.mood(), "pleased");
  assert.ok(s.logs.some((l) => l.msg === "build.promoted" && l.fields?.via === "conflict"));

  // Resolving again is a no-op: no second flip.
  const flipsBefore = s.patches().length;
  s.loop.handoff(s.sessionId, handoff([await s.say("Sara", "yes, B")], {
    topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
  }));
  await flush();
  assert.equal(s.patches().length, flipsBefore);
});

const RESOLVE_B = (groundingIds: number[]) => handoff(groundingIds, {
  topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
});

test("ungrounded resolvedChoice is ignored", async () => {
  const s = await setup([[DONE_CONFLICT], [], [], [], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  await flush();
  const other = randomUUID();
  await s.store.createIntent(other, "https://meet.google.com/zzz-zzzz-zzz");
  const foreign = (await s.store.addEvent({ sessionId: other, recallMsgId: null, kind: "utterance", speaker: "Amir", text: "B" }))!.id;
  const bot = (await s.store.addEvent({ sessionId: s.sessionId, recallMsgId: null, kind: "utterance", speaker: "Builder", text: "So: B?" }))!.id;

  for (const ids of [[], [9999], [foreign], [bot]]) {
    s.loop.handoff(s.sessionId, RESOLVE_B(ids));
    await flush();
    assert.equal(s.doc().conflicts[0].status, "open", `not resolved with grounding ${JSON.stringify(ids)}`);
  }
  assert.equal(s.requests.length, 1, "no floor bypass: the merged hand-off waits for the floor");
  assert.equal(s.logs.filter((l) => l.msg === "build.resolve_ungrounded").length, 4);
  assert.equal(findNode(s.proto(), "home.tabs"), undefined);
});

test("model batch cannot mark nodes agreed", async () => {
  const s = await setup([[
    patches("Added: quick-add", [
      { op: "add", parentId: "home", node: { id: "home.quick-add", type: "Input", props: [], status: "agreed", decisionId: "d-quick-add" } },
      { op: "add", parentId: "home", node: { id: "home.title", type: "Heading", props: [{ key: "text", value: "Tasks" }], status: "agreed" } },
    ]),
    patches("Settled: title", [{ op: "update", id: "home.title", status: "agreed", decisionId: "d-quick-add" }]),
    consensus([
      { op: "add_decision", id: "d-quick-add", text: "Quick-add", proposedBy: "Amir", affects: ["home.quick-add"] },
      { op: "add_conflict", id: "c-x", topic: "Where done tasks go", variants: [
        conflictVariant("A", "Toggle", ["Amir"], [
          { op: "add", parentId: "home", node: { id: "home.show-done", type: "Toggle", props: [], status: "agreed" } },
        ]),
        conflictVariant("B", "Agree the heading", ["Sara"], [{ op: "update", id: "home.title", status: "agreed", decisionId: "d-quick-add" }]),
      ] },
    ]),
  ]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add"), await s.say("Sara", "tabs")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "draft", "add is forced to draft");
  assert.equal(findNode(s.proto(), "home.quick-add")!.decisionId, "d-quick-add", "a draft keeps its decision id");
  const title = findNode(s.proto(), "home.title")!;
  assert.equal(title.status, "draft", "update to agreed is dropped");
  assert.equal(title.decisionId, undefined, "decisionId of a non-agreed decision is dropped with it");
  assert.equal(s.doc().decisions[0].status, "draft");

  const variants = s.doc().conflicts[0].variants;
  const addOp = variants[0].batch.ops[0] as { op: "add"; node: { status: string } };
  assert.equal(addOp.node.status, "draft", "stored variant adds are draft");
  assert.equal(variants[1].batch.ops.some((o) => o.op === "update" && o.status === "agreed"), false, "stored variant updates cannot agree");
  const view = s.sent.find((e): e is Extract<StageEvent, { type: "comparison" }> => e.type === "comparison");
  for (const v of view?.view?.variants ?? []) {
    assert.equal(JSON.stringify(v.proto).includes('"agreed"'), false, "no agreed node in any preview");
  }
});

test("objection to an agreed decision returns its nodes to draft", async () => {
  const s = await setup([
    [...QUICK_ADD, consensus([
      { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
      { op: "mark_pending", decisionId: "d-quick-add" },
      { op: "support", decisionId: "d-quick-add", speaker: "Sara" },
    ])],
    [patches("Removed: add button", [{ op: "remove", id: "home.quick-add-btn" }]), consensus([{ op: "object", decisionId: "d-quick-add", speaker: "Lee" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top"), await s.say("Sara", "yes")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "agreed");
  await s.timers.advance(10_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "actually no, I hate that")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "draft");
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "draft");
  const reopen = s.patches().filter((p) => p.changes[0]?.label.startsWith("Reopened: "));
  assert.equal(reopen.length, 1, "one batch");
  assert.equal(reopen[0].changes[0].label, "Reopened: Quick-add at top");
  assert.deepEqual(reopen[0].changes.map((c) => c.id), ["home.quick-add"], "missing ids skipped");
});

test("rejected winning batch does not flip pre-existing nodes", async () => {
  // B updates the existing heading, then adds under a missing parent, so its whole batch is rejected.
  const s = await setup([[
    patches("Added: heading", [addNode("home", "home.heading", "Heading", [["text", "Tasks"]])]),
    consensus([{
      op: "add_conflict", id: "c-done", topic: "Heading",
      variants: [
        conflictVariant("A", "Rename", ["Amir"], [{ op: "update", id: "home.heading", props: [{ key: "text", value: "To do" }] }]),
        conflictVariant("B", "Rename and tab", ["Sara"], [
          { op: "update", id: "home.heading", props: [{ key: "text", value: "Today" }] },
          addNode("missing", "missing.tabs", "Tabs"),
        ]),
      ],
    }]),
  ], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "rename"), await s.say("Sara", "today")]));
  await flush();
  s.loop.handoff(s.sessionId, RESOLVE_B([await s.say("Sara", "B please")]));
  await flush();
  const d = s.doc().decisions.find((x) => x.id === "d-c-done")!;
  assert.equal(d.status, "agreed");
  assert.deepEqual(d.affects, [], "a winner batch that did not apply touches nothing");
  assert.equal(s.patches().some((p) => p.changes[0]?.label.startsWith("Agreed: ")), false, "nothing flipped");
});

test("a throwing runtime during a run does not wedge the loop", async () => {
  const rejections: unknown[] = [];
  const onRejection = (r: unknown) => rejections.push(r);
  process.on("unhandledRejection", onRejection);
  try {
    const s = await setup([[...QUICK_ADD, consensus([
      { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add"] },
      { op: "mark_pending", decisionId: "d-quick-add" },
    ])]]);
    s.faults.runtime = true;
    s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
    await flush();
    assert.equal(s.loop.idle(s.sessionId), true, "inFlight cleared");
    assert.ok(s.logs.some((l) => l.msg === "build.run_failed" && l.fields?.error === "Error"));

    s.faults.runtime = false;
    s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
    await s.timers.advance(10_000);
    assert.equal(s.requests.length, 1, "the next hand-off still runs");
    assert.ok(findNode(s.proto(), "home.quick-add"));

    // A throwing tick is logged and the next tick still promotes.
    s.faults.runtime = true;
    await s.timers.advance(3_000);
    s.faults.runtime = false;
    await s.timers.advance(30_000);
    assert.equal(s.doc().decisions[0].status, "agreed");
    assert.ok(s.logs.some((l) => l.msg === "build.tick_failed"));

    // A throwing resolve inside handoff() is logged, not thrown. A pick is resolved once its grounding
    // lines are read, so the fault stays on until then.
    const sara = await s.say("Sara", "B");
    s.faults.runtime = true;
    assert.doesNotThrow(() => s.loop.handoff(s.sessionId, RESOLVE_B([sara])));
    await flush();
    s.faults.runtime = false;
    assert.ok(s.logs.some((l) => l.msg === "build.resolve_failed" && l.fields?.error === "Error"), "the resolve ran into the fault");
    assert.equal(JSON.stringify(s.logs).includes("runtime unavailable"), false, "errors logged by name only");
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

// ---- end of the call (known issue I5) ----

test("after end(), pending decisions stay pending, timers stop and later hand-offs make no model call", async () => {
  const s = await setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
  ])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "pending");
  s.loop.end(s.sessionId);
  await s.timers.advance(120_000);
  assert.equal(s.doc().decisions[0].status, "pending", "no promotion after the call: the handoff is final");
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "draft");
  s.loop.handoff(s.sessionId, handoff([await s.say("Sara", "and due dates")]));
  await s.timers.advance(60_000);
  assert.equal(s.requests.length, 1, "no model call after the call ended");
  assert.ok(s.logs.some((l) => l.msg === "build.handoff_ignored"));
  assert.equal(s.loop.idle(s.sessionId), true);
});

test("a run in flight when the call ends is discarded, and queued work is dropped", async () => {
  const g = gatedPort([[...QUICK_ADD], [...QUICK_ADD]]);
  const s = await setup(g.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
  await flush();
  s.loop.handoff(s.sessionId, handoff([await s.say("Sara", "yes please")], {}, "Queued"));
  await flush();
  assert.equal(s.requests.length, 1);
  s.loop.end(s.sessionId);
  g.release();
  await flush();
  await s.timers.advance(60_000);
  assert.equal(findNode(s.proto(), "home.quick-add"), undefined, "the late result never reaches the prototype");
  assert.equal(s.requests.length, 1, "the queued hand-off never runs");
  assert.ok(s.logs.some((l) => l.msg === "build.run" && l.fields?.discarded === "ended"));
});

test("invalid hand-offs are dropped without a model call", async () => {
  const s = await setup([[]]);
  s.loop.handoff(s.sessionId, { topics: "nope" } as unknown as Handoff);
  await flush();
  assert.equal(s.requests.length, 0);
  assert.ok(s.logs.some((l) => l.msg === "build.handoff_invalid"));
  assert.equal(s.loop.idle(s.sessionId), true);
});

test("tool schemas sent to the model are strict-compatible", async () => {
  const s = await setup([[]]);
  s.loop.handoff(s.sessionId, handoff([]));
  await flush();
  const sentSchemas = (s.requests[0].tools as { input_schema: unknown }[]).map((t) => t.input_schema);
  for (const schema of [...sentSchemas, toolJsonSchema(HandoffSchema)]) {
    const text = JSON.stringify(schema);
    for (const banned of ['"oneOf"', '"$ref"', '"$schema"', '"minimum"', '"maximum"', '"maxLength"', '"minLength"', '"maxItems"']) {
      assert.ok(!text.includes(banned), `no ${banned}`);
    }
    const walk = (s: unknown) => {
      if (Array.isArray(s)) return s.forEach(walk);
      if (!s || typeof s !== "object") return;
      const o = s as Record<string, unknown>;
      if (o.type === "object") assert.equal(o.additionalProperties, false);
      Object.values(o).forEach(walk);
    };
    walk(schema);
  }
});

// A port whose calls stay pending, so a test can stream tool calls into a run still in flight.
function heldPort() {
  const calls: { req: RunToolsRequest; resolve: (r: RunToolsResult) => void }[] = [];
  const port: ModelPort = { runTools: (req) => new Promise((resolve) => calls.push({ req, resolve })) };
  const release = async (i: number, toolCalls: ToolCall[] = [], stopReason: RunToolsResult["stopReason"] = "tool_use") => {
    calls[i].resolve({
      toolCalls, ms: 5, dropped: 0, stopReason,
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    await flush();
  };
  return { port, calls, release };
}

test("a streamed batch reaches the stage before the model call finishes", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await flush();
  assert.equal(s.patches().length, 1, "applied while the call is pending");
  assert.ok(findNode(s.proto(), "home.quick-add"));
  await held.release(0, [QUICK_ADD[0]]);
  assert.equal(s.patches().length, 1, "not applied a second time");
});

test("a refusal after a streamed batch keeps the batch and applies it once", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await flush();
  await held.release(0, [], "refusal");
  assert.equal(s.patches().length, 1);
  assert.ok(findNode(s.proto(), "home.quick-add"));
});

test("build calls use effort low", async () => {
  const s = await setup([[]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "hi")]));
  await flush();
  assert.equal(s.requests[0].effort, "low");
});

test("build.run logs wait_ms, first_patch_ms and last_patch_ms", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  await s.timers.advance(200);
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await s.timers.advance(300);
  held.calls[0].req.onToolCall?.(patches("Added: label", [addNode("home", "home.label", "Text", [["text", "Tasks"]])]));
  await flush();
  await held.release(0, [QUICK_ADD[0]]);
  const run = s.logs.find((l) => l.msg === "build.run")!.fields!;
  assert.equal(typeof run.wait_ms, "number");
  assert.equal(run.first_patch_ms, 200);
  assert.equal(run.last_patch_ms, 500);
  assert.equal(run.patches_applied, 2);

  const t = await setup([[]]);
  t.loop.handoff(t.sessionId, handoff([await t.say("Amir", "hi")]));
  await flush();
  const empty = t.logs.find((l) => l.msg === "build.run")!.fields!;
  assert.equal(empty.first_patch_ms, null);
  assert.equal(empty.last_patch_ms, null);
});

type TasksEvent = Extract<StageEvent, { type: "tasks" }>;
const taskEvents = (sent: StageEvent[]) => sent.filter((e): e is TasksEvent => e.type === "tasks");
const lastTasks = (sent: StageEvent[]) => taskEvents(sent).at(-1)?.tasks ?? [];
const withTask = (ids: number[], task: string, title = "Adding tasks") =>
  handoff(ids, { topics: [{ ...handoff(ids, {}, title).topics[0], task }] });

test("hand-off topics show as queued, then now during the run, then done and gone after 3s", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, withTask([await s.say("Amir", "quick add")], "Adding the buttons"));
  await flush();
  const states = taskEvents(s.sent).map((e) => e.tasks.map((t) => t.state).join(","));
  assert.deepEqual(states, ["queued", "now"]);
  assert.deepEqual(lastTasks(s.sent), [{ id: "t1", text: "Adding the buttons", state: "now" }]);
  assert.deepEqual((s.rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>).tasks, lastTasks(s.sent));
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await held.release(0, [QUICK_ADD[0]]);
  assert.deepEqual(lastTasks(s.sent), [{ id: "t1", text: "Adding the buttons", state: "done" }]);
  await s.timers.advance(TASK_DONE_MS - 1);
  assert.equal(lastTasks(s.sent).length, 1, "still showing");
  await s.timers.advance(1);
  assert.deepEqual(lastTasks(s.sent), []);
  const log = s.logs.find((l) => l.msg === "build.tasks")!.fields!;
  assert.deepEqual(Object.keys(log).sort(), ["done", "now", "queued", "session_id"]);
});

test("task text falls back to the topic title and is cut to 40 characters", () => {
  const base = handoff([1]).topics[0];
  assert.equal(taskText({ ...base, task: "  Moving search to the top " }), "Moving search to the top");
  assert.equal(taskText({ ...base, task: "  ", title: "Adding tasks" }), "Adding tasks");
  const cut = taskText({ ...base, title: "x".repeat(60) });
  assert.equal(cut.length, 40);
  assert.equal(cut, `${"x".repeat(39)}…`);
  assert.equal(taskText({ ...base, title: "y".repeat(40) }), "y".repeat(40));
  // The cut lands on a space: no "word …".
  assert.equal(taskText({ ...base, title: `${"a".repeat(38)} bcd` }), `${"a".repeat(38)}…`);
  assert.equal(taskText({ ...base, task: " ", title: "  " }), "");
});

test("a topic with no task and no title gets no task row", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "hi")], {}, "   "));
  await flush();
  assert.deepEqual(lastTasks(s.sent), []);
});

test("build.run counts streamed patches when the model stops at max_tokens", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await flush();
  await held.release(0, [], "max_tokens");
  const run = s.logs.find((l) => l.msg === "build.run")!.fields!;
  assert.equal(run.patches_applied, 1);
  assert.equal(run.patches_rejected, 0);
});

test("a streamed batch resets the pending-region scan so the next block starts fresh", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  const req = held.calls[0].req;
  req.onToolInputDelta?.("apply_patches", '{"label":"x","ops":[{"op":"add","parentId":"home","node":{"id":"a"}}]}');
  req.onToolCall?.(QUICK_ADD[0]);
  for (const c of ['{"label":"y","ops":[{"op":"add","parentId":"oth', 'er","node":{"id":"b"}}]}']) req.onToolInputDelta?.("apply_patches", c);
  const regions = s.sent.filter((e): e is Extract<StageEvent, { type: "pending_region" }> => e.type === "pending_region").map((e) => e.parentId);
  assert.deepEqual(regions, ["home", null, "other"]);
  await held.release(0, [], "refusal");
});

test("a hand-off during a run stays queued until the follow-up run", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, withTask([await s.say("Amir", "quick add")], "First"));
  await flush();
  s.loop.handoff(s.sessionId, withTask([await s.say("Sara", "dark mode")], "Second"));
  await flush();
  assert.deepEqual(lastTasks(s.sent).map((t) => [t.text, t.state]), [["First", "now"], ["Second", "queued"]]);
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await held.release(0, [QUICK_ADD[0]]);
  assert.deepEqual(lastTasks(s.sent).map((t) => [t.text, t.state]), [["Second", "queued"], ["First", "done"]]);
  await s.timers.advance(3_000);
  assert.equal(held.calls.length, 2);
  assert.deepEqual(lastTasks(s.sent).map((t) => [t.text, t.state]), [["Second", "now"]]);
  await held.release(1);
  assert.deepEqual(lastTasks(s.sent), []);
});

test("a run that applies nothing removes its tasks at once, without done", async () => {
  const s = await setup([[]]);
  s.loop.handoff(s.sessionId, withTask([await s.say("Amir", "hi")], "Nothing"));
  await flush();
  assert.deepEqual(lastTasks(s.sent), []);
  assert.equal(taskEvents(s.sent).some((e) => e.tasks.some((t) => t.state === "done")), false);
});

test("a refusal after a streamed batch still marks the tasks done", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, withTask([await s.say("Amir", "quick add")], "Adding"));
  await flush();
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await held.release(0, [], "refusal");
  assert.deepEqual(lastTasks(s.sent).map((t) => t.state), ["done"]);
});

test("a throwing run leaves no task stuck on now", async () => {
  const failing: ModelPort = { runTools: () => Promise.reject(new Error("boom")) };
  const a = await setup(failing);
  a.loop.handoff(a.sessionId, withTask([await a.say("Amir", "x")], "Adding"));
  await flush();
  assert.deepEqual(lastTasks(a.sent), []);

  const b = await setup([[]]);
  b.faults.runtime = true;
  b.loop.handoff(b.sessionId, withTask([await b.say("Amir", "x")], "Adding"));
  await flush();
  assert.equal(taskEvents(b.sent).some((e) => e.tasks.some((t) => t.state === "now")), false);
  assert.equal(b.loop.idle(b.sessionId), true);
  assert.ok(b.logs.some((l) => l.msg === "build.tasks_failed"));
});

// ---- agreed nodes change only through decisions (known issue I2) ----

const AGREE_QUICK_ADD = [...QUICK_ADD, consensus([
  { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
  { op: "mark_pending", decisionId: "d-quick-add" },
  { op: "support", decisionId: "d-quick-add", speaker: "Sara" },
])];

test("a model change to an agreed node sends it back to draft until a decision covering it is agreed (known issue I2)", async () => {
  const s = await setup([
    AGREE_QUICK_ADD,
    [
      patches("Changed: placeholder", [
        { op: "update", id: "home.quick-add", props: [{ key: "placeholder", value: "New task" }], decisionId: "d-placeholder" },
        // Changes nothing, so it is dropped: an update cannot demote an agreed node by itself.
        { op: "update", id: "home.quick-add-btn", props: [{ key: "label", value: "Add" }], status: "draft" },
      ], "Lee"),
      consensus([
        { op: "add_decision", id: "d-placeholder", text: "Say 'New task'", proposedBy: "Lee", affects: [] },
        { op: "mark_pending", decisionId: "d-placeholder" },
      ]),
    ],
    [consensus([{ op: "support", decisionId: "d-placeholder", speaker: "Sara" }])],
    [consensus([{ op: "object", decisionId: "d-quick-add", speaker: "Lee" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top"), await s.say("Sara", "yes")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "agreed");

  await s.timers.advance(10_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "the box should say New task")]));
  await flush();
  const input = findNode(s.proto(), "home.quick-add")!;
  assert.deepEqual([input.status, input.decisionId, input.props.placeholder], ["draft", "d-placeholder", "New task"], "changed, so not agreed any more");
  assert.equal(findNode(s.proto(), "home.quick-add-btn")!.status, "agreed", "a no-op update leaves the node alone");
  assert.deepEqual(s.patches().at(-1)!.changes.map((c) => c.id), ["home.quick-add"]);
  assert.equal(s.doc().decisions.find((d) => d.id === "d-quick-add")!.status, "agreed", "the earlier decision stands");

  await s.timers.advance(10_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Sara", "sure, New task")]));
  await flush();
  const agreed = findNode(s.proto(), "home.quick-add")!;
  assert.deepEqual([agreed.status, agreed.decisionId], ["agreed", "d-placeholder"], "drawn with the decision's id, so its agreement flips it");

  // Reopening the first decision leaves the node another decision has agreed since.
  await s.timers.advance(10_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "actually, no quick-add")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.quick-add-btn")!.status, "draft");
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "agreed");
});

test("a model remove of an agreed node, or of anything holding one, is dropped unless the run reopens its decision (known issue I2)", async () => {
  const s = await setup([
    [
      ...AGREE_QUICK_ADD,
      patches("Added: note", [addNode("home", "home.box", "Stack"), addNode("home.box", "home.box.note", "Text", [["text", "Due Fri"]], "d-note")], "Amir"),
      consensus([
        { op: "add_decision", id: "d-note", text: "A due note", proposedBy: "Amir", affects: ["home.box.note"] },
        { op: "mark_pending", decisionId: "d-note" },
        { op: "support", decisionId: "d-note", speaker: "Sara" },
      ]),
    ],
    [patches("Removed: quick-add", [{ op: "remove", id: "home.quick-add" }]), patches("Removed: box", [{ op: "remove", id: "home.box" }])],
    [patches("Removed: add button", [{ op: "remove", id: "home.quick-add-btn" }]), consensus([{ op: "object", decisionId: "d-quick-add", speaker: "Lee" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top, and a due note"), await s.say("Sara", "yes")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.box")!.status, "draft");
  assert.equal(findNode(s.proto(), "home.box.note")!.status, "agreed");

  await s.timers.advance(10_000);
  const before = s.patches().length;
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "tidy it up")]));
  await flush();
  for (const id of ["home.quick-add", "home.box", "home.box.note"]) assert.ok(findNode(s.proto(), id), `${id} is still there`);
  assert.equal(s.patches().length, before, "nothing drawn");
  assert.equal(s.logs.filter((l) => l.msg === "build.run").at(-1)?.fields?.patches_empty, 2);

  await s.timers.advance(10_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "no, drop the quick-add button")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.quick-add-btn"), undefined, "its decision was reopened in the same run");
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "draft");
  assert.equal(s.doc().decisions.find((d) => d.id === "d-quick-add")!.status, "draft");
});

// ---- a resolved choice claims a merge only when it happened (known issue I3) ----

test("the model sees resolvedChoice only for a pick merged just now; an unmerged pick becomes a redraw proposal (known issue I3)", async () => {
  // B updates the heading, then adds under a missing parent, so its whole batch is rejected at resolve time.
  const s = await setup([[
    patches("Added: heading", [addNode("home", "home.heading", "Heading", [["text", "Tasks"]])]),
    consensus([{
      op: "add_conflict", id: "c-done", topic: "Heading",
      variants: [
        conflictVariant("A", "Rename", ["Amir"], [{ op: "update", id: "home.heading", props: [{ key: "text", value: "To do" }] }]),
        conflictVariant("B", "Rename and tab", ["Sara"], [
          { op: "update", id: "home.heading", props: [{ key: "text", value: "Today" }] },
          addNode("missing", "missing.tabs", "Tabs"),
        ]),
      ],
    }]),
  ], [], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "rename"), await s.say("Sara", "today")]));
  await flush();
  s.loop.handoff(s.sessionId, RESOLVE_B([await s.say("Sara", "B please")]));
  await flush();
  assert.equal(s.requests.length, 2, "a new pick still bypasses the floor");
  const turn = s.userText(1);
  assert.ok(!turn.includes("resolvedChoice"), "the model is not told the winner merged");
  assert.ok(turn.includes("Redraw option B of conflict c-done, which the room picked (decision d-c-done): Rename and tab"));
  assert.ok((s.requests[1].messages as { content: string }[])[0].content.includes(`"proposedBy":"Sara"`), "credited to a backer heard picking it");
  assert.ok(s.logs.some((l) => l.msg === "build.resolve_unmerged"));

  // Picking it again settles nothing new: no claim, no redraw, no floor bypass.
  s.loop.handoff(s.sessionId, RESOLVE_B([await s.say("Amir", "yes, B")]));
  await flush();
  assert.equal(s.requests.length, 2);
  await s.timers.advance(10_000);
  assert.equal(s.requests.length, 3);
  assert.ok(!s.userText(2).includes("resolvedChoice") && !s.userText(2).includes("Redraw"));
});

test("a pick merged just now reaches the model as resolvedChoice (known issue I3)", async () => {
  const s = await setup([[DONE_CONFLICT], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  await flush();
  s.loop.handoff(s.sessionId, RESOLVE_B([await s.say("Sara", "B")]));
  await flush();
  assert.ok(findNode(s.proto(), "home.tabs"));
  assert.ok((s.requests[1].messages as { content: string }[])[0].content.includes(`"resolvedChoice":{"conflictId":"c-done","winner":"B"}`));
});

// ---- one comparison at a time (known issue M1) ----

test("two conflicts raised in one run are shown one after the other (known issue M1)", async () => {
  const due = consensus([{
    op: "add_conflict", id: "c-due", topic: "Due dates",
    variants: [
      conflictVariant("A", "A due date on every task", ["Amir"], [addNode("home", "home.due", "Input", [["label", "Due"]])]),
      conflictVariant("B", "No due dates yet", ["Sara"], [addNode("home", "home.later", "Text", [["text", "Due dates later"]])]),
    ],
  }]);
  const s = await setup([[DONE_CONFLICT, due], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle, and due dates"), await s.say("Sara", "a tab, no due dates")]));
  await flush();
  const shown = () => s.sent.filter((e): e is Extract<StageEvent, { type: "comparison" }> => e.type === "comparison").map((e) => e.view?.conflictId ?? null);
  assert.deepEqual(shown(), ["c-done"], "the first conflict is on screen");
  assert.ok(s.logs.some((l) => l.msg === "build.comparison_queued" && l.fields?.conflict_id === "c-due"));
  assert.equal(s.logs.find((l) => l.msg === "build.run")?.fields?.conflicts, 2);

  s.loop.handoff(s.sessionId, RESOLVE_B([await s.say("Sara", "B")]));
  await flush();
  assert.deepEqual(shown(), ["c-done", "c-due"], "the next conflict follows the one resolved");
  const types = s.sent.map((e) => e.type);
  assert.ok(types.indexOf("resolve") < types.lastIndexOf("comparison"));
  const snap = s.rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>;
  assert.equal(snap.comparison?.conflictId, "c-due");
  assert.ok(findNode(snap.comparison!.variants[0].proto, "home.tabs"), "built on the prototype with the first winner merged");
});

// ---- on-screen credit is grounded (known issue M9) ----

test("a batch's by must be someone heard in the grounding lines (known issue M9)", async () => {
  const s = await setup([[
    patches("Added: quick-add", [addNode("home", "home.quick-add", "Input")], "Bob"),
    patches("Added: button", [addNode("home", "home.add", "Button", [["label", "Add"]])], "Amir"),
    consensus([{
      op: "add_conflict", id: "c-x", topic: "Where done tasks go",
      variants: [
        { ...conflictVariant("A", "Toggle", ["Amir"], [addNode("home", "home.show-done", "Toggle")]), batch: { label: "Option A", by: "Bob", ops: [addNode("home", "home.show-done", "Toggle")] } },
        { ...conflictVariant("B", "Tab", ["Sara"], [addNode("home", "home.tabs", "Tabs")]), batch: { label: "Option B", by: "Sara", ops: [addNode("home", "home.tabs", "Tabs")] } },
      ],
    }]),
  ]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add"), await s.say("Sara", "tabs")]));
  await flush();
  const credits = s.patches().flatMap((p) => p.changes.map((c) => [c.id, c.by ?? null]));
  assert.deepEqual(credits, [["home.quick-add", null], ["home.add", "Amir"]], "Bob was never heard: no credit");
  const variants = s.doc().conflicts[0].variants;
  assert.deepEqual(variants.map((v) => v.batch.by ?? null), [null, "Sara"]);
  assert.equal(s.logs.find((l) => l.msg === "build.run")?.fields?.grounding_dropped, 2);
});

// ---- a promotion waits for objections already on their way (known issue M10) ----

const PENDING_QUICK_ADD = [...QUICK_ADD, consensus([
  { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
  { op: "mark_pending", decisionId: "d-quick-add" },
])];

test("a decision due while an objection to it is being applied is never shown as agreed (known issue M10)", async () => {
  const g = gatedPort([PENDING_QUICK_ADD, [consensus([{ op: "object", decisionId: "d-quick-add", speaker: "Lee" }])]]);
  const s = await setup(g.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
  await flush();
  g.release();
  await flush();
  assert.equal(s.doc().decisions[0].status, "pending");

  await s.timers.advance(20_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "no, I don't want that")]));
  await flush();
  assert.equal(s.requests.length, 2, "the objection's run is in flight");
  await s.timers.advance(15_000); // 35 s pending: due, but held
  assert.equal(s.doc().decisions[0].status, "pending", "held while its objection may be on the way");
  g.release();
  await flush();
  await s.timers.advance(60_000);
  assert.equal(s.doc().decisions[0].status, "draft");
  assert.equal(s.patches().some((p) => p.changes[0]?.label.startsWith("Agreed: ")), false, "never flipped to agreed and back");
});

test("a held promotion goes through once the earlier hand-offs are applied; later ones don't hold it (known issue M10)", async () => {
  const g = gatedPort([PENDING_QUICK_ADD, [], []]);
  const s = await setup(g.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
  await flush();
  g.release();
  await flush();
  await s.timers.advance(20_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Sara", "and tags later")]));
  await flush();
  await s.timers.advance(20_000); // due at 30 s, held by the run in flight
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "what about colours")])); // received after it was due
  await flush();
  assert.equal(s.doc().decisions[0].status, "pending");
  g.release();
  await flush();
  assert.equal(s.requests.length, 3, "the later hand-off's run is in flight");
  await s.timers.advance(1_000);
  assert.equal(s.doc().decisions[0].status, "agreed", "promoted without waiting for the later hand-off");
  assert.equal(findNode(s.proto(), "home.quick-add")!.status, "agreed");
  g.release();
  await flush();
});

// ---- after a restart (known issue M2) ----

test("after a restart, resume() runs the no-objection timer again for decisions still pending (known issue M2)", async () => {
  const s = await setup([PENDING_QUICK_ADD]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add at the top")]));
  await flush();
  s.loop.end(s.sessionId); // the old process is gone, and its timers with it
  await s.rt.saved();
  const runtime = createRuntime({ store: s.store, clock: s.timers.now, channel: { send() {}, sendAudio() {}, clients: () => 0 } });
  await runtime.load(s.sessionId);
  const loop = createBuildLoop({ port: createFakePort([]), runtime, store: s.store, clock: s.timers.now, timers: s.timers });
  const status = () => (runtime(s.sessionId).snapshot() as Extract<StageEvent, { type: "snapshot" }>).doc.decisions[0].status;
  await s.timers.advance(40_000);
  assert.equal(status(), "pending", "nothing runs the timer yet");
  loop.resume(s.sessionId);
  await s.timers.advance(1_000);
  assert.equal(status(), "agreed");
  assert.equal(findNode((runtime(s.sessionId).snapshot() as Extract<StageEvent, { type: "snapshot" }>).proto, "home.quick-add")!.status, "agreed");
});

test("a batch that streams in after the call ended is not drawn", async () => {
  const held = heldPort();
  const s = await setup(held.port);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add")]));
  await flush();
  s.loop.end(s.sessionId);
  held.calls[0].req.onToolCall?.(QUICK_ADD[0]);
  await held.release(0, [QUICK_ADD[0]]);
  assert.equal(s.patches().length, 0);
  assert.equal(findNode(s.proto(), "home.quick-add"), undefined);
});
