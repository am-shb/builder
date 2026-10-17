import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createFakePort } from "../src/agent/llm.ts";
import type { ModelPort, RunToolsRequest, RunToolsResult, ToolCall } from "../src/agent/llm.ts";
import { createBuildLoop, toolJsonSchema } from "../src/agent/build-loop.ts";
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

function setup(portOrScript: ModelPort | ToolCall[][]) {
  const store = openStore(":memory:");
  const sessionId = randomUUID();
  store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
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
  const loop = createBuildLoop({ port, runtime, store, clock: timers.now, log: (msg, fields) => logs.push({ msg, fields }), timers });
  const rt = runtime(sessionId);
  const snap = () => rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>;
  return {
    store, sessionId, timers, sent, timeline, requests, logs, loop, rt,
    doc: (): ConsensusDoc => snap().doc,
    proto: (): Prototype => snap().proto,
    mood: () => snap().mood,
    say: (speaker: string, text: string) => store.addEvent({ sessionId, recallMsgId: null, kind: "utterance", speaker, text })!.id,
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
  const s = setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
    { op: "set_phase", phase: "explore" },
    { op: "set_next_up", items: ["Sara, should done tasks stay visible?"] },
    { op: "add_open_question", text: "Where do done tasks go?", raisedBy: "Sara" },
  ])]]);
  const g = s.say("Amir", "Let's put a quick-add box right at the top of the list");
  s.loop.handoff(s.sessionId, handoff([g]));
  assert.equal(s.loop.idle(s.sessionId), false, "a run is in flight");
  await flush();

  // Request shape: build loop, medium effort, two strict tools, grounding lines in the user turn.
  assert.equal(s.requests.length, 1);
  const req = s.requests[0];
  assert.equal(req.loop, "build");
  assert.equal(req.effort, "medium");
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

  const saved = s.store.getConsensus(s.sessionId)!;
  assert.equal(saved.doc.decisions[0].status, "pending");
  assert.ok(findNode(saved.proto, "home.quick-add-btn"));

  // Cost recorded through withCostRecording; mood went thinking and back.
  assert.equal(s.store.listModelCalls(s.sessionId).length, 1);
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
  const s = setup({
    async runTools(req) {
      for (const chunk of ['{"label":"Added: x","ops":[{"op":"add","pa', 'rentId":"ho', 'me","node":{"id":"a"}}', ',{"op":"add","parentId":"other"']) {
        req.onToolInputDelta?.("apply_patches", chunk);
      }
      return fake.runTools(req);
    },
  });
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "quick add please")]));
  await flush();
  const regions = s.sent.filter((e): e is Extract<StageEvent, { type: "pending_region" }> => e.type === "pending_region").map((e) => e.parentId);
  assert.deepEqual(regions, ["home", null], "one region from the first parentId, cleared at the end");
  const moods = s.sent.filter((e) => e.type === "mood").map((e) => (e as { mood: string }).mood);
  assert.ok(moods.includes("building"));
  assert.equal(s.mood(), "listening");
});

test("support by a speaker not in grounding lines is dropped", async () => {
  const s = setup([[consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: [] },
    { op: "mark_pending", decisionId: "d-quick-add" },
    { op: "support", decisionId: "d-quick-add", speaker: "Bob" },
    { op: "add_decision", id: "d-ghost", text: "Dark mode", proposedBy: "Bob", affects: [] },
  ])]]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "quick-add at the top"), s.say("Sara", "hmm, maybe")]));
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
  const s = setup(g.port);
  const g1 = s.say("Amir", "first line");
  const g2 = s.say("Sara", "second line");
  const g3 = s.say("Lee", "third line");
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

test("10s floor between runs; resolvedChoice bypasses it", async () => {
  const s = setup([[DONE_CONFLICT], [], [], []]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "toggle"), s.say("Sara", "tab")]));
  await flush();
  assert.equal(s.requests.length, 1);
  assert.equal(s.doc().conflicts[0].status, "open");

  await s.timers.advance(1_000);
  s.loop.handoff(s.sessionId, handoff([s.say("Lee", "something else")]));
  await flush();
  assert.equal(s.requests.length, 1, "within the floor");
  assert.equal(s.loop.idle(s.sessionId), false, "a run is scheduled");
  await s.timers.advance(8_000);
  assert.equal(s.requests.length, 1);
  await s.timers.advance(1_000);
  assert.equal(s.requests.length, 2, "runs once 10 s have passed since the last run started");

  await s.timers.advance(500);
  const before = s.timeline.length;
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "ok B")], {
    topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
  }));
  await flush();
  assert.equal(s.requests.length, 3, "a resolved conflict bypasses the floor");
  const after = s.timeline.slice(before);
  assert.ok(after.indexOf("ev:resolve") >= 0 && after.indexOf("ev:resolve") < after.indexOf("call"), "resolveComparison runs before the model call");
  assert.equal(s.doc().conflicts[0].status, "resolved");
});

test("invalid patch batch from model is rejected; screen unchanged; run still updates doc", async () => {
  const s = setup([[
    patches("Added: orphan", [addNode("nope", "nope.child", "Text", [["text", "hi"]])]),
    patches("Added: bogus", [{ op: "explode", id: "home" }]),
    patches("Way too long a label for the stage to show without truncating it badly", [addNode("home", "home.x", "Text")]),
    consensus([{ op: "add_decision", id: "d-1", text: "Quick-add", proposedBy: "Amir", affects: [] }]),
  ]]);
  const before = s.proto();
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "quick add")]));
  await flush();
  assert.deepEqual(s.proto(), before, "screen unchanged");
  assert.equal(s.patches().length, 0, "nothing rendered");
  assert.equal(s.doc().decisions[0].id, "d-1", "doc still updated");
  const run = s.logs.find((l) => l.msg === "build.run")!;
  assert.equal(run.fields?.patches_rejected, 3);
  assert.equal(run.fields?.patches_applied, 0);
});

test("a refusal or zero valid calls leaves the screen and doc unchanged", async () => {
  const s = setup({
    async runTools() {
      return { toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, ms: 1, stopReason: "refusal", dropped: 2 };
    },
  });
  const proto = s.proto();
  const doc = s.doc();
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "quick add")]));
  await flush();
  assert.deepEqual(s.proto(), proto);
  assert.deepEqual(s.doc(), doc);
  assert.equal(s.sent.filter((e) => e.type === "doc" || e.type === "patch").length, 0);
  const run = s.logs.find((l) => l.msg === "build.run")!;
  assert.equal(run.fields?.stop_reason, "refusal");
  assert.equal(run.fields?.dropped, 2);
  assert.equal(s.store.listModelCalls(s.sessionId).length, 1, "a refused call is still billed and recorded");
});

test("add_conflict shows comparison with ≥2 valid variants", async () => {
  const s = setup([[DONE_CONFLICT]]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "toggle"), s.say("Sara", "tab")]));
  await flush();
  const views = s.sent.filter((e): e is Extract<StageEvent, { type: "comparison" }> => e.type === "comparison");
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].view!.variants.map((v) => v.label), ["A", "B"]);
  assert.equal(views[0].view!.conflictId, "c-done");
  assert.equal(findNode(s.proto(), "home.tabs"), undefined, "variants are not applied to the main prototype");
});

test("add_conflict with fewer than 2 applicable variants records the conflict but shows no comparison", async () => {
  const s = setup([[consensus([{
    op: "add_conflict", id: "c-x", topic: "Where done tasks go",
    variants: [
      conflictVariant("A", "Toggle", ["Amir"], [addNode("home", "home.show-done", "Toggle")]),
      conflictVariant("B", "Tab", ["Sara"], [addNode("missing", "missing.tabs", "Tabs")]),
    ],
  }])]]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "toggle"), s.say("Sara", "tab")]));
  await flush();
  assert.equal(s.sent.some((e) => e.type === "comparison"), false);
  assert.equal(s.doc().conflicts[0].id, "c-x");
  assert.ok(s.logs.some((l) => l.msg === "build.comparison_skipped" && l.fields?.conflict_id === "c-x"));
});

test("pending item auto-agrees after 30s and sets pleased mood", async () => {
  const s = setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
  ])]]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "quick add at the top")]));
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
  const s = setup([[...QUICK_ADD, consensus([
    { op: "add_decision", id: "d-quick-add", text: "Quick-add at top", proposedBy: "Amir", affects: ["home.quick-add", "home.quick-add-btn", "home.gone"] },
    { op: "mark_pending", decisionId: "d-quick-add" },
    { op: "support", decisionId: "d-quick-add", speaker: "Sara" },
  ])]]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "quick add at the top"), s.say("Sara", "yes, love that")]));
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
  const s = setup([[DONE_CONFLICT], []]);
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "toggle"), s.say("Sara", "tab")]));
  await flush();
  s.loop.handoff(s.sessionId, handoff([s.say("Amir", "fine, B")], {
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
  s.loop.handoff(s.sessionId, handoff([], {
    topics: [{ title: "Done tasks", proposals: [], questionsRaised: [], resolvedChoice: { conflictId: "c-done", winner: "B" } }],
  }));
  await flush();
  assert.equal(s.patches().length, flipsBefore);
});

test("invalid hand-offs are dropped without a model call", async () => {
  const s = setup([[]]);
  s.loop.handoff(s.sessionId, { topics: "nope" } as unknown as Handoff);
  await flush();
  assert.equal(s.requests.length, 0);
  assert.ok(s.logs.some((l) => l.msg === "build.handoff_invalid"));
  assert.equal(s.loop.idle(s.sessionId), true);
});

test("tool schemas sent to the model are strict-compatible", async () => {
  const s = setup([[]]);
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
