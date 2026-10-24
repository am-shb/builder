import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { settle, testStore } from "./helpers/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createFakePort } from "../src/agent/llm.ts";
import type { ModelPort, RunToolsRequest, RunToolsResult, ToolCall } from "../src/agent/llm.ts";
import { createBuildLoop, taskText, TASK_DONE_MS } from "../src/agent/build-loop.ts";
import { toolJsonSchema } from "../src/agent/tool-schema.ts";
import { enforceGrounding, HandoffSchema, sanitizeModelBatch } from "../src/agent/handoff.ts";
import type { ConsensusUpdate } from "../src/agent/handoff.ts";
import type { Handoff } from "../src/agent/handoff.ts";
import { applyBatch, emptyPrototype, findNode, fromToolBatch } from "../src/ui/tree.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { Prototype } from "../src/ui/schema.ts";
// @ts-ignore plain JS module shared with the browser
import { OFFERED_TYPES } from "../public/renderer/catalog.js";

const flush = () => settle();

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
const sharedStore = testStore();

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
  node: { id, type, props: props.map(([key, value]) => ({ key, value })), ...(decisionId ? { decisionId } : {}) },
});

const QUICK_ADD = [
  patches("Added: quick-add · Amir", [
    addNode("home", "home.quick-add", "Text", [["text", "Add a task"]], "d-quick-add"),
    addNode("home", "home.quick-add-btn", "Button", [["label", "Add"]], "d-quick-add"),
  ], "Amir"),
];

const conflictVariant = (label: string, summary: string, backers: string[], ops: unknown[]) =>
  ({ label, summary, backers, batch: { label: `Option ${label}`, ops } });

const DONE_CONFLICT = consensus([{
  op: "add_conflict", id: "c-done", topic: "Where done tasks go",
  variants: [
    conflictVariant("A", "Hide done tasks behind a toggle", ["Amir"], [addNode("home", "home.show-done", "Badge", [["text", "Show done"]])]),
    conflictVariant("B", "Move done tasks to a Done tab", ["Sara"], [addNode("home", "home.tabs", "Card", [["title", "Done"]])]),
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

test("enforceGrounding keeps conflict backers from priorBackers, and nothing else", () => {
  const conflict = { op: "add_conflict" as const, id: "c1", topic: "T", variants: [
    conflictVariant("A", "a", ["Amin", "Ghost", "Rita"], [addNode("home", "home.special", "Badge")]),
    conflictVariant("B", "b", ["Omid"], []),
  ] } as unknown as Extract<ConsensusUpdate, { op: "add_conflict" }>;
  const r = enforceGrounding([conflict], new Set(["Omid"]), [
    { names: ["Amin"], affects: ["home.special"] },
    { names: ["Rita"], affects: ["home.header"] },
  ]);
  const op = r.ops[0] as typeof conflict;
  assert.deepEqual(op.variants.map((v) => v.backers), [["Amin"], ["Omid"]]);
  assert.equal(r.dropped, 2, "Ghost is in neither; Rita's decision affects another part of the screen");

  const r2 = enforceGrounding([
    { op: "support", decisionId: "d1", speaker: "Amin" },
    { op: "add_decision", id: "d2", text: "x", proposedBy: "Amin", affects: [] },
  ], new Set(["Omid"]), [{ names: ["Amin"], affects: ["home.special"] }]);
  assert.deepEqual(r2.ops, [], "support and add_decision still need this hand-off's speakers");
  assert.equal(r2.dropped, 2);
});

test("a conflict recorded in a later hand-off keeps the earlier proposer as a backer of their variant", async () => {
  const s = await setup([
    [consensus([{ op: "add_decision", id: "d-top", text: "The special on top", proposedBy: "Amin", affects: ["home.special-a"] }])],
    [consensus([{ op: "add_conflict", id: "c-special", topic: "Special placement", variants: [
      conflictVariant("A", "Special on top", ["Amin"], [addNode("home", "home.special-a", "Badge", [["text", "Special"]])]),
      conflictVariant("B", "Special at the bottom", ["Omid"], [addNode("home", "home.special-b", "Badge", [["text", "Special"]])]),
    ] }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amin", "the special on top")]));
  await flush();
  s.loop.handoff(s.sessionId, handoff([await s.say("Omid", "no, at the bottom")], {}, "Placement"));
  await flush();
  await s.timers.advance(30_000);
  const c = s.doc().conflicts.find((x) => x.id === "c-special")!;
  assert.deepEqual(c.variants.map((v) => v.backers), [["Amin"], ["Omid"]]);
});

test("only an open decision's proposer, not its supporters, can back a conflict variant from an earlier hand-off", async () => {
  const s = await setup([
    [consensus([{ op: "add_conflict", id: "c1", topic: "Special", variants: [
      conflictVariant("A", "Special on top", ["Amin", "Rita"], [{ op: "update", id: "home.special", props: [{ key: "title", value: "Top" }] }]),
      conflictVariant("B", "Special below", ["Omid"], [addNode("home", "home.other", "Badge", [["text", "Other"]])]),
    ] }])],
  ]);
  assert.equal(s.rt.applyBatch({ label: "seed", ops: [{ op: "add", parentId: "home", node: { id: "home.special", type: "Card", props: { title: "Special" }, status: "draft", decisionId: "dX", children: [] } }] }).ok, true);
  s.rt.setDoc({ ...emptyDoc(), decisions: [{ id: "dX", text: "Special", status: "pending", pendingSince: s.timers.now(), proposedBy: "Amin", agreedBy: ["Rita"], affects: ["home.special"], rejectedOptions: [] }] });
  s.loop.handoff(s.sessionId, handoff([await s.say("Omid", "I'd put it below")]));
  await flush();
  const c = s.doc().conflicts.find((x) => x.id === "c1")!;
  assert.deepEqual(c.variants.map((v) => v.backers), [["Amin"], ["Omid"]]);
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

test("a conflict variant with one unoffered add keeps its other ops, and the run counts the skip", async () => {
  const s = await setup([[consensus([{
    op: "add_conflict", id: "c-done", topic: "Where done tasks go",
    variants: [
      conflictVariant("A", "Badge", ["Amir"], [addNode("home", "home.show-done", "Badge", [["text", "Show done"]])]),
      conflictVariant("B", "Card with a heading", ["Sara"], [
        addNode("home", "home.done-card", "Card", [["title", "Done"]]),
        addNode("home", "home.done-heading", "Heading", [["text", "Done"]]),
      ]),
    ],
  }])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "badge"), await s.say("Sara", "card")]));
  await flush();
  const conflict = s.doc().conflicts[0];
  assert.deepEqual(conflict.variants.map((v) => v.label), ["A", "B"]);
  assert.deepEqual(conflict.variants[1].batch.ops.map((o) => (o.op === "add" ? o.node.id : o.op)), ["home.done-card"]);
  assert.ok(s.sent.some((e) => e.type === "comparison"), "the comparison still shows");
  assert.equal(s.logs.find((l) => l.msg === "build.run")!.fields?.ops_unoffered, 1);
});

test("an apply_patches batch with an unoffered add and its child keeps the rest", async () => {
  const s = await setup([[patches("Added: mixed", [
    addNode("home", "home.title", "Heading", [["text", "Tasks"]]),
    addNode("home.title", "home.title.sub", "Text", [["text", "sub"]]),
    addNode("home", "home.note", "Text", [["text", "Due Fri"]]),
  ])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a title and a note")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.title"), undefined);
  assert.equal(findNode(s.proto(), "home.title.sub"), undefined);
  assert.ok(findNode(s.proto(), "home.note"));
  assert.equal(s.logs.find((l) => l.msg === "build.run")!.fields?.ops_unoffered, 2);
});

test("add_conflict with fewer than 2 applicable variants records the conflict but shows no comparison", async () => {
  const s = await setup([[consensus([{
    op: "add_conflict", id: "c-x", topic: "Where done tasks go",
    variants: [
      conflictVariant("A", "Toggle", ["Amir"], [addNode("home", "home.show-done", "Badge")]),
      conflictVariant("B", "Tab", ["Sara"], [addNode("missing", "missing.tabs", "Card")]),
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

test("taken() is null with nothing pending, and settles once a pick has read its grounding lines and merged", async () => {
  const s = await setup([[DONE_CONFLICT], []]);
  assert.equal(s.loop.taken(s.sessionId), null, "a session the loop hasn't seen");
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "toggle"), await s.say("Sara", "tab")]));
  assert.equal(s.loop.taken(s.sessionId), null, "a hand-off without a pick is taken at once");
  await flush();
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "fine, B")], {
    topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
  }));
  const pending = s.loop.taken(s.sessionId);
  assert.ok(pending, "the pick is still reading its grounding lines");
  assert.equal(findNode(s.proto(), "home.tabs"), undefined, "not merged yet");
  await pending;
  assert.ok(findNode(s.proto(), "home.tabs"), "B is merged once taken() settles");
  assert.equal(s.doc().conflicts.find((c) => c.id === "c-done")?.status, "resolved");
  assert.equal(s.loop.taken(s.sessionId), null, "nothing pending afterwards");
});

const RESOLVE_B = (groundingIds: number[]) => handoff(groundingIds, {
  topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
});

const conflictOp = (id: string, aNode: string, bNode: string) => ({
  op: "add_conflict", id, topic: `Topic ${id}`,
  variants: [
    conflictVariant("A", "Option A", ["Amir"], [addNode("home", aNode, "Badge", [["text", "A"]])]),
    conflictVariant("B", "Option B", ["Sara"], [addNode("home", bNode, "Card", [["title", "x"]])]),
  ],
});
const PICK_ANY_B = (groundingIds: number[]) => handoff(groundingIds, {
  topics: [{ title: "Pick", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "*", winner: "B" } }],
});

test("a pick with no conflict id merges B when exactly one conflict is open", async () => {
  const s = await setup([[consensus([conflictOp("c-top", "home.a", "home.b")])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a"), await s.say("Sara", "b")]));
  await flush();
  s.loop.handoff(s.sessionId, PICK_ANY_B([await s.say("Amir", "B please")]));
  await flush();
  assert.ok(findNode(s.proto(), "home.b"), "B is merged");
  assert.equal(findNode(s.proto(), "home.a"), undefined);
  const d = s.doc().decisions.find((x) => x.id === "d-c-top")!;
  assert.equal(d.status, "agreed");
});

test("the speaker of a pick is recorded as agreeing even when not a backer", async () => {
  const s = await setup([[consensus([conflictOp("c-top", "home.a", "home.b")])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a"), await s.say("Sara", "b")]));
  await flush();
  s.loop.handoff(s.sessionId, PICK_ANY_B([await s.say("Mohammad Amin Shamshiri", "B please")]));
  await flush();
  const d = s.doc().decisions.find((x) => x.id === "d-c-top")!;
  assert.ok(d.agreedBy.includes("Mohammad Amin Shamshiri"));
  assert.ok(d.agreedBy.includes("Sara"));
});

test("a pick with no conflict id merges nothing when two conflicts are open", async () => {
  const s = await setup([[consensus([conflictOp("c-one", "home.a1", "home.b1"), conflictOp("c-two", "home.a2", "home.b2")])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a"), await s.say("Sara", "b")]));
  await flush();
  s.loop.handoff(s.sessionId, PICK_ANY_B([await s.say("Amir", "B please")]));
  await flush();
  assert.deepEqual(s.doc().conflicts.map((c) => c.status), ["open", "open"]);
  assert.equal(findNode(s.proto(), "home.b1"), undefined);
  assert.equal(findNode(s.proto(), "home.b2"), undefined);
  assert.deepEqual(s.logs.find((l) => l.msg === "build.resolve_ambiguous")?.fields, { session_id: s.sessionId, open: 2 });
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
    // The tool format has no status: a batch or a variant that sends one is rejected whole.
    patches("Added: quick-add", [
      { op: "add", parentId: "home", node: { id: "home.quick-add", type: "Text", props: [], status: "agreed", decisionId: "d-quick-add" } },
    ]),
    patches("Settled: title", [{ op: "update", id: "home.title", status: "agreed", decisionId: "d-quick-add" }]),
    consensus([{ op: "add_conflict", id: "c-y", topic: "Toggle", variants: [
      conflictVariant("A", "Toggle", ["Amir"], [{ op: "add", parentId: "home", node: { id: "home.show-done", type: "Badge", props: [], status: "agreed" } }]),
      conflictVariant("B", "Tab", ["Sara"], [addNode("home", "home.tabs", "Card")]),
    ] }]),
    patches("Added: title", [addNode("home", "home.title", "Text", [["text", "Tasks"]], "d-quick-add")]),
    consensus([
      { op: "add_decision", id: "d-quick-add", text: "Quick-add", proposedBy: "Amir", affects: ["home.title"] },
      { op: "add_conflict", id: "c-x", topic: "Where done tasks go", variants: [
        conflictVariant("A", "Toggle", ["Amir"], [addNode("home", "home.show-done", "Badge")]),
        conflictVariant("B", "Rename the heading", ["Sara"], [{ op: "update", id: "home.title", props: [{ key: "text", value: "Today" }] }]),
      ] },
    ]),
  ]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "quick add"), await s.say("Sara", "tabs")]));
  await flush();
  assert.equal(findNode(s.proto(), "home.quick-add"), undefined, "a batch with a status is rejected");
  const title = findNode(s.proto(), "home.title")!;
  assert.deepEqual([title.status, title.decisionId], ["draft", "d-quick-add"], "added nodes are drafts and keep their decision id");
  assert.equal(s.doc().decisions[0].status, "draft");
  const run = s.logs.find((l) => l.msg === "build.run")!;
  assert.equal(run.fields?.patches_rejected, 2);
  assert.equal(run.fields?.consensus_invalid, 1, "the call whose variant sent a status is rejected");

  assert.deepEqual(s.doc().conflicts.map((c) => c.id), ["c-x"]);
  const variants = s.doc().conflicts[0].variants;
  const addOp = variants[0].batch.ops[0] as { op: "add"; node: { status: string } };
  assert.equal(addOp.node.status, "draft", "stored variant adds are draft");
  assert.equal(variants[1].batch.ops.some((o) => o.op === "update" && o.status === "agreed"), false, "stored variant updates cannot agree");
  const view = s.sent.find((e): e is Extract<StageEvent, { type: "comparison" }> => e.type === "comparison");
  assert.ok(view?.view);
  for (const v of view.view.variants) {
    assert.equal(JSON.stringify(v.proto).includes('"agreed"'), false, "no agreed node in any preview");
  }
});

// ---- theme ops in model batches (Review Focus 3) ----

function agreedGold() {
  const r1 = applyBatch(emptyPrototype("X"), { label: "t", ops: [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }] });
  assert.ok(r1.ok);
  const r2 = applyBatch(r1.proto, { label: "t", ops: [{ op: "theme_status", decisionId: "d1", to: "agreed" }] });
  assert.ok(r2.ok);
  return r2.proto;
}

test("drop_theme on an agreed slot is dropped unless reopened", () => {
  const proto = agreedGold();
  const doc = emptyDoc();
  const batch = { label: "Dropped: gold", ops: [{ op: "theme_status" as const, decisionId: "d1", to: "revert" as const }] };
  assert.deepEqual(sanitizeModelBatch(batch, doc, { proto, reopened: new Set() }).ops, [], "an agreed theme stays");
  assert.deepEqual(sanitizeModelBatch(batch, doc, { proto, reopened: new Set(["d1"]) }).ops, batch.ops, "kept when the run reopens it");

  const draft = applyBatch(emptyPrototype("X"), { label: "t", ops: [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }] });
  assert.ok(draft.ok);
  assert.deepEqual(sanitizeModelBatch(batch, doc, { proto: draft.proto, reopened: new Set() }).ops, batch.ops, "a draft theme may be dropped");
  assert.deepEqual(sanitizeModelBatch(batch, doc).ops, [], "variants never revert");
});

test("a model batch cannot send theme_status agreed", () => {
  const draft = applyBatch(emptyPrototype("X"), { label: "t", ops: [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }] });
  assert.ok(draft.ok);
  const doc = emptyDoc();
  const setTheme = { op: "set_theme" as const, values: { accent: "green" }, decisionId: "d2" };
  const batch = { label: "x", ops: [{ op: "theme_status" as const, decisionId: "d1", to: "agreed" as const }, setTheme] };
  assert.deepEqual(sanitizeModelBatch(batch, doc, { proto: draft.proto, reopened: new Set(["d1"]) }).ops, [setTheme]);
  assert.deepEqual(sanitizeModelBatch(batch, doc).ops, [setTheme]);
});

test("a set_theme slot already at its current value is dropped, so previous stays right", () => {
  const proto = agreedGold();
  const doc = emptyDoc();
  const same = { label: "x", ops: [{ op: "set_theme" as const, values: { accent: "gold" }, decisionId: "d1" }] };
  assert.deepEqual(sanitizeModelBatch(same, doc, { proto, reopened: new Set() }).ops, [], "nothing left to set");
  const mixed = { label: "x", ops: [{ op: "set_theme" as const, values: { accent: "gold", radius: "round" }, decisionId: "d1" }] };
  assert.deepEqual(sanitizeModelBatch(mixed, doc, { proto, reopened: new Set() }).ops,
    [{ op: "set_theme", values: { radius: "round" }, decisionId: "d1" }]);
  const r = applyBatch(proto, sanitizeModelBatch(mixed, doc, { proto, reopened: new Set() }));
  assert.ok(r.ok);
  assert.deepEqual(r.proto.theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
  assert.deepEqual(sanitizeModelBatch(same, doc).ops, same.ops, "variants are not compared with the current theme");
});

test("an update whose props all drop leaves an agreed node alone (known issue I2)", () => {
  const added = applyBatch(emptyPrototype("X"), { label: "t", ops: [
    { op: "add", parentId: "home", node: { id: "b", type: "Button", props: { label: "Go" }, status: "agreed", decisionId: "d1", children: [] } },
  ] });
  assert.ok(added.ok);
  const { batch, dropped } = fromToolBatch({ label: "x", decisionId: "d9", ops: [
    { op: "update", id: "b", props: [{ key: "color", value: "#f00" }] },
  ] }, {}, added.proto);
  assert.equal(dropped, 1);
  const doc = { ...emptyDoc(), decisions: [{ id: "d1", text: "Go button", status: "agreed" as const, proposedBy: "Amir", agreedBy: ["Sara"], affects: ["b"], rejectedOptions: [] }] };
  assert.deepEqual(sanitizeModelBatch(batch, doc, { proto: added.proto, reopened: new Set() }).ops, []);
});

test("a variant update whose props all drop does not retag the node", async () => {
  const s = await setup([[
    patches("Added: heading", [addNode("home", "home.heading", "Text", [["text", "Tasks"]])]),
    consensus([{ op: "add_conflict", id: "c1", topic: "Heading", variants: [
      conflictVariant("A", "Red", ["Amir"], [{ op: "update", id: "home.heading", props: [{ key: "color", value: "red" }] }]),
      conflictVariant("B", "Toggle", ["Sara"], [addNode("home", "home.show-done", "Badge")]),
    ] }]),
  ]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "red"), await s.say("Sara", "toggle")]));
  await flush();
  const [a, b] = s.doc().conflicts[0].variants;
  assert.deepEqual(a.batch.ops, [], "nothing left to do, so nothing to retag");
  assert.equal(b.batch.ops.length, 1);
});

test("conflict variants default to d-<conflictId>", async () => {
  const s = await setup([[consensus([{
    op: "add_conflict", id: "c1", topic: "Accent",
    variants: [
      conflictVariant("A", "Gold", ["Amir"], [{ op: "set_theme", accent: "gold" }]),
      { ...conflictVariant("B", "Green", ["Sara"], [{ op: "set_theme", accent: "green" }]), batch: { label: "Option B", decisionId: "d-own", ops: [{ op: "set_theme", accent: "green" }] } },
    ],
  }])]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "gold"), await s.say("Sara", "green")]));
  await flush();
  const [a, b] = s.doc().conflicts[0].variants;
  assert.deepEqual(a.batch.ops, [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d-c1" }]);
  assert.deepEqual(b.batch.ops, [{ op: "set_theme", values: { accent: "green" }, decisionId: "d-c1" }], "a variant's own decisionId is ignored");
});

test("resolving a theme conflict agrees the slot under d-<conflictId>", async () => {
  const s = await setup([[consensus([{
    op: "add_conflict", id: "c1", topic: "Accent",
    variants: [
      conflictVariant("A", "Gold", ["Amir"], [{ op: "set_theme", accent: "gold" }]),
      { ...conflictVariant("B", "Green", ["Sara"], []), batch: { label: "Option B", decisionId: "d-own", ops: [{ op: "set_theme", accent: "green" }] } },
    ],
  }])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "gold"), await s.say("Sara", "green")]));
  await flush();
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "fine, green")], {
    topics: [{ title: "Accent", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }],
  }));
  await flush();
  assert.equal(s.doc().decisions.find((d) => d.id === "d-c1")!.status, "agreed");
  assert.deepEqual(s.proto().theme!.accent, { value: "green", status: "agreed", decisionId: "d-c1", previous: "slate" });
});

test("props the catalog does not know are dropped and counted, never logged", async () => {
  const s = await setup([[
    patches("Added: button", [addNode("home", "home.go", "Button", [["label", "Go"], ["color", "#f00"], ["variant", "neon"]])]),
    consensus([{ op: "add_conflict", id: "c1", topic: "Button", variants: [
      conflictVariant("A", "Big", ["Amir"], [addNode("home", "home.big", "Button", [["label", "Big"], ["px", 40]])]),
      conflictVariant("B", "Small", ["Sara"], [addNode("home", "home.small", "Button", [["label", "Small"]])]),
    ] }]),
  ]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a button"), await s.say("Sara", "small")]));
  await flush();
  assert.deepEqual(findNode(s.proto(), "home.go")!.props, { label: "Go" });
  const dropped = s.logs.filter((l) => l.msg === "build.props_dropped");
  assert.deepEqual(dropped.map((l) => l.fields), [
    { session_id: s.sessionId, count: 2 },
    { session_id: s.sessionId, count: 1, source: "conflict" },
  ]);
});

// A theme proposal as the model sends it: one set_theme op under the batch's decisionId.
const themeBatch = (decisionId: string, accent: string, by = "Amir"): ToolCall =>
  ({ name: "apply_patches", input: { label: `Proposed: ${accent} accent`, by, decisionId, ops: [{ op: "set_theme", accent }] } });
const themeDecision = (id: string, accent: string, ...more: unknown[]) => consensus([
  { op: "add_decision", id, text: `${accent[0].toUpperCase()}${accent.slice(1)} accent`, proposedBy: "Amir", affects: [] },
  { op: "mark_pending", decisionId: id },
  ...more,
]);

test("agreeing a theme decision flips its slots", async () => {
  const s = await setup([[themeBatch("d1", "gold"), themeDecision("d1", "gold", { op: "support", decisionId: "d1", speaker: "Sara" })]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold"), await s.say("Sara", "yes, gold")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "agreed");
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
  const flips = s.patches().filter((p) => p.changes[0]?.label === "Agreed: Gold accent");
  assert.equal(flips.length, 1, "one batch");
  assert.deepEqual(flips[0].changes.map((c) => [c.kind, c.id]), [["theme", "app"]]);
});

test("the 30 s timeout agrees a pending theme", async () => {
  const s = await setup([[themeBatch("d1", "gold"), themeDecision("d1", "gold")]]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold")]));
  await flush();
  assert.equal(s.proto().theme!.accent.status, "draft");
  await s.timers.advance(30_000);
  assert.equal(s.doc().decisions[0].status, "agreed");
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
});

test("an objection reverts a draft theme", async () => {
  const s = await setup([
    [themeBatch("d1", "gold"), themeDecision("d1", "gold")],
    [consensus([{ op: "object", decisionId: "d1", speaker: "Lee" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold")]));
  await flush();
  assert.equal(s.proto().theme!.accent.value, "gold");
  await s.timers.advance(10_000);
  const before = s.patches().length;
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "no, not gold")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "draft");
  assert.deepEqual(s.proto().theme!.accent, { value: "slate", status: "agreed", previous: "slate", reverted: { value: "gold", decisionId: "d1" } });
  const reverts = s.patches().slice(before).filter((p) => p.changes.some((c) => c.kind === "theme"));
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0].changes[0].label, "Reverted: Gold accent");
  assert.ok(s.logs.some((l) => l.msg === "build.theme_reverted" && l.fields?.decision_id === "d1" && l.fields?.session_id === s.sessionId));
  await s.timers.advance(30_000);
  assert.equal(s.proto().theme!.accent.value, "slate", "the timeout does not bring it back");
});

test("an objection to an agreed theme reverts to the theme before it", async () => {
  const s = await setup([
    [themeBatch("d0", "blue"), themeDecision("d0", "blue", { op: "support", decisionId: "d0", speaker: "Sara" })],
    [themeBatch("d1", "gold"), themeDecision("d1", "gold", { op: "support", decisionId: "d1", speaker: "Sara" })],
    [consensus([{ op: "object", decisionId: "d1", speaker: "Lee" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "blue"), await s.say("Sara", "yes")]));
  await flush();
  await s.timers.advance(5_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "actually gold"), await s.say("Sara", "yes")]));
  await flush();
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "blue" });
  await s.timers.advance(5_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "I preferred blue")]));
  await flush();
  assert.equal(s.doc().decisions.find((d) => d.id === "d1")!.status, "draft");
  assert.deepEqual(s.proto().theme!.accent, { value: "blue", status: "agreed", previous: "blue", reverted: { value: "gold", decisionId: "d1" } });
});

test("an objection and renewed support in one hand-off leave the theme up; once agreed it stays gold", async () => {
  const s = await setup([
    [themeBatch("d1", "gold"), themeDecision("d1", "gold")],
    [themeBatch("d1", "gold"), consensus([
      { op: "object", decisionId: "d1", speaker: "Lee" },
      { op: "support", decisionId: "d1", speaker: "Sara" },
    ])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold")]));
  await flush();
  await s.timers.advance(5_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "not gold"), await s.say("Sara", "I like gold")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "pending");
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "draft", decisionId: "d1", previous: "slate" });
  assert.ok(!s.logs.some((l) => l.msg === "build.theme_reverted"));
  await s.timers.advance(30_000);
  assert.equal(s.doc().decisions[0].status, "agreed");
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
});

test("a theme reverted by an objection comes back when its decision is agreed in a later turn", async () => {
  const s = await setup([
    [themeBatch("d1", "gold"), themeDecision("d1", "gold")],
    [consensus([{ op: "object", decisionId: "d1", speaker: "Lee" }])],
    [consensus([{ op: "support", decisionId: "d1", speaker: "Sara" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold")]));
  await flush();
  await s.timers.advance(5_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Lee", "not gold")]));
  await flush();
  assert.equal(s.proto().theme!.accent.value, "slate");
  await s.timers.advance(5_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Sara", "I'd still go gold")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "pending");
  assert.equal(s.proto().theme!.accent.value, "slate", "not shown again until agreed");
  await s.timers.advance(30_000);
  assert.equal(s.doc().decisions[0].status, "agreed");
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
});

test("the model sees the theme in the prototype block", async () => {
  const s = await setup([[themeBatch("d1", "gold"), themeDecision("d1", "gold")], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold")]));
  await flush();
  assert.match(s.userText(0), /theme: house default/);
  await s.timers.advance(5_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "and add tasks")]));
  await flush();
  const text = s.userText(1);
  const block = text.slice(text.indexOf("<prototype"), text.indexOf("</prototype>"));
  assert.ok(block.includes("theme: accent=gold (draft, d1); warmth=neutral (agreed); radius=soft (agreed); density=regular (agreed)"));
});

test("an ungrounded objection does not revert", async () => {
  const s = await setup([
    [themeBatch("d1", "gold"), themeDecision("d1", "gold")],
    [consensus([{ op: "object", decisionId: "d1", speaker: "Lee" }])],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "let's make it gold")]));
  await flush();
  await s.timers.advance(10_000);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "gold it is")]));
  await flush();
  assert.equal(s.doc().decisions[0].status, "pending");
  assert.deepEqual(s.proto().theme!.accent, { value: "gold", status: "draft", decisionId: "d1", previous: "slate" });
  assert.ok(!s.logs.some((l) => l.msg === "build.theme_reverted"));
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
    patches("Added: heading", [addNode("home", "home.heading", "Text", [["text", "Tasks"]])]),
    consensus([{
      op: "add_conflict", id: "c-done", topic: "Heading",
      variants: [
        conflictVariant("A", "Rename", ["Amir"], [{ op: "update", id: "home.heading", props: [{ key: "text", value: "To do" }] }]),
        conflictVariant("B", "Rename and tab", ["Sara"], [
          { op: "update", id: "home.heading", props: [{ key: "text", value: "Today" }] },
          addNode("missing", "missing.tabs", "Card"),
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

test("the update_consensus schema offers only OFFERED_TYPES for variant nodes", async () => {
  const s = await setup([[]]);
  s.loop.handoff(s.sessionId, handoff([]));
  await flush();
  const tools = s.requests[0].tools as { name: string; input_schema: unknown }[];
  const schema = tools.find((t) => t.name === "update_consensus")!.input_schema;
  const enums: unknown[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, any>;
    if (o.properties?.type?.enum && o.properties.id) enums.push(o.properties.type.enum);
    Object.values(o).forEach(walk);
  };
  walk(schema);
  assert.ok(enums.length >= 1, "variant nodes carry a type enum");
  for (const e of enums) assert.deepEqual(e, OFFERED_TYPES);
});

// A port whose calls stay pending, so a test can stream tool calls into a run still in flight.
function heldPort() {
  const calls: { req: RunToolsRequest; resolve: (r: RunToolsResult) => void }[] = [];
  const port: ModelPort = { runTools: (req) => new Promise((resolve) => calls.push({ req, resolve })) };
  const release = async (i: number, toolCalls: ToolCall[] = [], stopReason: RunToolsResult["stopReason"] = "tool_use", dropped = 0) => {
    calls[i].resolve({
      toolCalls, ms: 5, dropped, stopReason,
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

test("a run that only records consensus marks its tasks done, unless the model's tool calls were dropped", async () => {
  const decide = consensus([{ op: "add_decision", id: "d1", text: "Show done items", proposedBy: "Amir", affects: [] }]);
  for (const [dropped, done] of [[0, true], [1, false]] as const) {
    const held = heldPort();
    const s = await setup(held.port);
    s.loop.handoff(s.sessionId, withTask([await s.say("Amir", "add some done items")], "Adding done items"));
    await flush();
    await held.release(0, [decide], "tool_use", dropped);
    assert.equal(taskEvents(s.sent).some((e) => e.tasks.some((t) => t.state === "done")), done, `dropped ${dropped}`);
  }
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
        { op: "update", id: "home.quick-add", props: [{ key: "text", value: "New task" }], decisionId: "d-placeholder" },
        // Changes nothing, so it is dropped: an update cannot demote an agreed node by itself.
        { op: "update", id: "home.quick-add-btn", props: [{ key: "label", value: "Add" }] },
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
  assert.deepEqual([input.status, input.decisionId, input.props.text], ["draft", "d-placeholder", "New task"], "changed, so not agreed any more");
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
      patches("Added: note", [addNode("home", "home.box", "Card"), addNode("home.box", "home.box.note", "Text", [["text", "Due Fri"]], "d-note")], "Amir"),
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
    patches("Added: heading", [addNode("home", "home.heading", "Text", [["text", "Tasks"]])]),
    consensus([{
      op: "add_conflict", id: "c-done", topic: "Heading",
      variants: [
        conflictVariant("A", "Rename", ["Amir"], [{ op: "update", id: "home.heading", props: [{ key: "text", value: "To do" }] }]),
        conflictVariant("B", "Rename and tab", ["Sara"], [
          { op: "update", id: "home.heading", props: [{ key: "text", value: "Today" }] },
          addNode("missing", "missing.tabs", "Card"),
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
      conflictVariant("A", "A due date on every task", ["Amir"], [addNode("home", "home.due", "Text", [["text", "Due"]])]),
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
    patches("Added: quick-add", [addNode("home", "home.quick-add", "Text")], "Bob"),
    patches("Added: button", [addNode("home", "home.add", "Button", [["label", "Add"]])], "Amir"),
    consensus([{
      op: "add_conflict", id: "c-x", topic: "Where done tasks go",
      variants: [
        { ...conflictVariant("A", "Toggle", ["Amir"], [addNode("home", "home.show-done", "Badge")]), batch: { label: "Option A", by: "Bob", ops: [addNode("home", "home.show-done", "Badge")] } },
        { ...conflictVariant("B", "Tab", ["Sara"], [addNode("home", "home.tabs", "Card")]), batch: { label: "Option B", by: "Sara", ops: [addNode("home", "home.tabs", "Card")] } },
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

test("a spoken pick followed by a model hand-off carrying the same pick resolves once", async () => {
  const s = await setup([[consensus([conflictOp("c-top", "home.a", "home.b")])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a"), await s.say("Sara", "b")]));
  await flush();
  const pick = (ids: number[]) => handoff(ids, {
    topics: [{ title: "Pick", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-top", winner: "B" } }],
  });
  s.loop.handoff(s.sessionId, pick([await s.say("Omid", "let's go with B")]));
  await flush();
  s.loop.handoff(s.sessionId, pick([await s.say("Omid", "let's go with B")]));
  await flush();
  assert.equal(s.doc().decisions.filter((d) => d.id === "d-c-top").length, 1);
  assert.equal(s.sent.filter((e) => e.type === "resolve").length, 1);
});

async function resolvedPick(s: Awaited<ReturnType<typeof setup>>) {
  s.rt.setDoc({ ...s.doc(), conflicts: [{ id: "c1", topic: "T", status: "open", openedAt: 0, variants: [
    { label: "A", summary: "a", backers: ["Sara"], batch: { label: "A", ops: [] } },
    { label: "B", summary: "b", backers: ["Bob"], batch: { label: "B", ops: [] } },
  ] }] });
  s.rt.resolveComparison("c1", "B", ["Sara"]);
}
const agreedBy = (s: Awaited<ReturnType<typeof setup>>) => s.doc().decisions.find((x) => x.id === "d-c1")!.agreedBy;

test("lateAgree adds exactly the speaker of a stored line that names the winner, once, within 20 s", async () => {
  const s = await setup([[]]);
  await resolvedPick(s);
  await s.timers.advance(6000);
  const id = await s.say("Amir", "Agreed, B it is");
  assert.equal(await s.loop.lateAgree(s.sessionId, { conflictId: "c1", winner: "B", lineId: id }), true);
  assert.deepEqual(agreedBy(s), ["Bob", "Sara", "Amir"]);
  assert.equal(await s.loop.lateAgree(s.sessionId, { conflictId: "c1", winner: "B", lineId: id }), false, "once");
  assert.deepEqual(agreedBy(s), ["Bob", "Sara", "Amir"]);
});

test("lateAgree adds nobody for a line that does not pick the winner, a bot line, a wrong winner or a late line", async () => {
  const s = await setup([[]]);
  await resolvedPick(s);
  await s.timers.advance(6000);
  const other = await s.say("Lee", "I don't like it, can we talk about the header?");
  const wrong = await s.say("Lee", "A it is");
  const bot = await s.say("Builder", "B it is");
  for (const lineId of [other, wrong, bot]) await s.loop.lateAgree(s.sessionId, { conflictId: "c1", winner: "B", lineId });
  assert.equal(await s.loop.lateAgree(s.sessionId, { conflictId: "c1", winner: "A", lineId: wrong }), false, "A is not the winner");
  await s.timers.advance(20_000);
  const late = await s.say("Lee", "B it is");
  assert.equal(await s.loop.lateAgree(s.sessionId, { conflictId: "c1", winner: "B", lineId: late }), false, "past 20 s");
  assert.deepEqual(agreedBy(s), ["Bob", "Sara"]);
});

test("a model-originated hand-off repeating the pick adds nobody to the decision", async () => {
  const s = await setup([[], []]);
  await resolvedPick(s);
  const pick = handoff([await s.say("Lee", "I object to B, honestly")], { topics: [{ title: "Pick", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }] });
  s.loop.handoff(s.sessionId, pick);
  await flush();
  await s.timers.advance(5000);
  assert.deepEqual(agreedBy(s), ["Bob", "Sara"]);
});

test("prior backers are not accepted through the App root, a Screen, or an update that changes nothing", () => {
  const variant = (ops: unknown[]) => [{ op: "add_conflict", id: "c1", topic: "T", variants: [
    conflictVariant("A", "a", ["Rita"], ops), conflictVariant("B", "b", ["Omid"], [addNode("home", "home.x", "Badge")]),
  ] }] as unknown as ConsensusUpdate[];
  const backersOfA = (ops: unknown[], affects: string[]) => {
    const r = enforceGrounding(variant(ops), new Set(["Omid"]), [{ names: ["Rita"], affects }], new Set(["home"]));
    return (r.ops[0] as Extract<ConsensusUpdate, { op: "add_conflict" }>).variants[0].backers;
  };
  const upd = (id: string, extra: object = {}) => ({ op: "update", id, ...extra });
  assert.deepEqual(backersOfA([upd("app", { props: [{ key: "title", value: "x" }] })], ["app"]), [], "the App root");
  assert.deepEqual(backersOfA([upd("home", { props: [{ key: "title", value: "x" }] })], ["home"]), [], "a Screen id");
  assert.deepEqual(backersOfA([addNode("home", "scr2", "Screen")], ["scr2"]), [], "an added Screen");
  assert.deepEqual(backersOfA([upd("home.card")], ["home.card"]), [], "an update with no props and no decisionId");
  assert.deepEqual(backersOfA([upd("home.card", { props: [{ key: "title", value: "x" }] })], ["home.card"]), ["Rita"], "a real update counts");
  assert.deepEqual(backersOfA([upd("home.card", { decisionId: "d1" })], ["home.card"]), ["Rita"], "a decisionId update counts");
  assert.deepEqual(backersOfA([{ op: "move", id: "home.card", parentId: "home", index: 0 }], ["home.card"]), [], "a move only makes room");
});

// ---- a pick closes the losing side's earlier proposal (task 8c) ----

test("a pick supersedes the loser's earlier open proposal; a later reference to it does not resurrect it", async () => {
  const s = await setup([
    [
      patches("Proposed: special on top", [addNode("home", "home.special", "Card", [["title", "Fall special"]], "dX")], "Amin"),
      consensus([
        { op: "add_decision", id: "dX", text: "Feature the fall special at the top", proposedBy: "Amin", affects: ["home.special"] },
        { op: "mark_pending", decisionId: "dX" },
        { op: "add_conflict", id: "c1", topic: "Top of home", variants: [
          conflictVariant("A", "Special on top", ["Amin"], [{ op: "update", id: "home.special", props: [{ key: "title", value: "Top special" }] }]),
          conflictVariant("B", "Order again on top", ["Omid"], [addNode("home", "home.order-again", "Card", [["title", "Order again"]]), { op: "move", id: "home.special", parentId: "home", index: 1 }]),
        ] },
      ]),
    ],
    [],
    [
      consensus([{ op: "support", decisionId: "dX", speaker: "Amin" }]),
      patches("Smaller special", [{ op: "update", id: "home.special", props: [{ key: "title", value: "Small special" }], decisionId: "dX" }], "Amin"),
    ],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amin", "special on top"), await s.say("Omid", "order again on top")]));
  await flush();
  assert.ok(s.doc().decisions.some((d) => d.id === "dX"), "proposed first");
  s.loop.handoff(s.sessionId, handoff([await s.say("Omid", "order again, B")], {
    topics: [{ title: "Top of home", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }],
  }));
  await flush();
  assert.ok(!s.doc().decisions.some((d) => d.id === "dX"), "dX is superseded");
  const picked = s.doc().decisions.find((d) => d.id === "d-c1")!;
  assert.equal(picked.status, "agreed");
  assert.deepEqual(picked.agreedBy, ["Omid"], "nobody joins agreedBy because their proposal was superseded");
  assert.ok(picked.rejectedOptions.includes("Feature the fall special at the top"));
  assert.deepEqual([findNode(s.proto(), "home.special")!.status, findNode(s.proto(), "home.special")!.decisionId], ["agreed", "d-c1"]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amin", "keep the special as a smaller card below")]));
  await flush();
  assert.ok(!s.doc().decisions.some((d) => d.id === "dX"), "a follow-up naming dX does not bring it back");
  assert.deepEqual([findNode(s.proto(), "home.special")!.status, findNode(s.proto(), "home.special")!.decisionId], ["agreed", "d-c1"], "still agreed under d-c1");
});

test("a pick never agrees a node only the losing variant touched: it keeps its superseded tag as a draft", async () => {
  const s = await setup([
    [
      patches("Proposed: special", [addNode("home", "home.special", "Card", [["title", "Fall special"]], "dX")], "Amin"),
      consensus([
        { op: "add_decision", id: "dX", text: "Feature the fall special", proposedBy: "Amin", affects: ["home.special"] },
        { op: "add_conflict", id: "c1", topic: "Top of home", variants: [
          conflictVariant("A", "Special on top", ["Amin"], [{ op: "update", id: "home.special", props: [{ key: "title", value: "Top special" }] }]),
          conflictVariant("B", "Order again on top", ["Omid"], [addNode("home", "home.again", "Card", [["title", "Order again"]])]),
        ] },
      ]),
    ],
    [],
  ]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amin", "special on top"), await s.say("Omid", "order again on top")]));
  await flush();
  s.loop.handoff(s.sessionId, handoff([await s.say("Omid", "let's go with B")], {
    topics: [{ title: "Top of home", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c1", winner: "B" } }],
  }));
  await flush();
  assert.ok(!s.doc().decisions.some((d) => d.id === "dX"), "dX is superseded");
  const special = findNode(s.proto(), "home.special")!;
  assert.deepEqual([special.decisionId, special.status], ["dX", "draft"], "only A touched it: nobody agreed it");
  const again = findNode(s.proto(), "home.again")!;
  assert.deepEqual([again.decisionId, again.status], ["d-c1", "agreed"]);
});

// ---- only people whose own line picks the winner are recorded as agreeing (task 8d) ----

test("a model pick records as agreeing only the speaker whose line picks the winner", async () => {
  const s = await setup([[consensus([conflictOp("c1", "home.a", "home.b")])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a"), await s.say("Sara", "b")]));
  await flush();
  const ids = [await s.say("Rita", "I'd rather A"), await s.say("Mona", "let's go with B")];
  s.loop.handoff(s.sessionId, PICK_ANY_B(ids));
  await flush();
  const d = s.doc().decisions.find((x) => x.id === "d-c1")!;
  assert.deepEqual(d.agreedBy, ["Sara", "Mona"], "B's backers plus Mona; Rita objected");
});

test("a loosely phrased model pick still resolves but records only the backers", async () => {
  const s = await setup([[consensus([conflictOp("c1", "home.a", "home.b")])], []]);
  s.loop.handoff(s.sessionId, handoff([await s.say("Amir", "a"), await s.say("Sara", "b")]));
  await flush();
  s.loop.handoff(s.sessionId, PICK_ANY_B([await s.say("Mona", "B sounds good")]));
  await flush();
  const d = s.doc().decisions.find((x) => x.id === "d-c1")!;
  assert.equal(d.status, "agreed");
  assert.deepEqual(d.agreedBy, ["Sara"]);
});
