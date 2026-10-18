import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { openStore } from "../src/store.ts";
import { createRuntime, handleStageMessage } from "../src/session/runtime.ts";
import { resolveCommand, createUiCommandRunner } from "../src/agent/ui-command.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import { initialUiState } from "../public/renderer/interact.js";
import type { Prototype } from "../src/ui/schema.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import { withStage } from "./helpers/stage.ts";

const todo = (): Prototype => JSON.parse(readFileSync(new URL("./fixtures/proto-todo.json", import.meta.url), "utf8"));

// Two screens: home (Add button, a list titled "Add", a Settings button) and settings (a dark mode switch).
function twoScreens(): Prototype {
  const p = todo();
  p.root.children[0].children.push({ id: "home.addlist", type: "List", props: { title: "Add" }, status: "draft", children: [] });
  p.root.children[0].children.push({
    id: "home.settings", type: "Button", props: { label: "Settings" }, status: "draft",
    on: { click: [{ kind: "navigate", screen: "settings" }] }, children: [],
  });
  p.root.children.push({
    id: "settings", type: "Screen", props: { title: "Settings" }, status: "draft", children: [
      { id: "settings.dark", type: "Toggle", props: { label: "Dark mode" }, status: "draft", children: [] },
      { id: "settings.back", type: "Button", props: { label: "Back" }, status: "draft", on: { click: [{ kind: "navigate", screen: "home" }] }, children: [] },
    ],
  });
  return p;
}
const without = (p: Prototype, id: string): Prototype => {
  const q = structuredClone(p);
  q.root.children[0].children = q.root.children[0].children.filter((c) => c.id !== id);
  return q;
};

test("click by label on current screen", () => {
  const p = without(twoScreens(), "home.addlist");
  const r = resolveCommand(p, initialUiState(p), { action: "click", target: "add" });
  assert.deepEqual(r, { ok: true, nodeId: "home.add", interaction: { kind: "append", list: "home.list", fromInput: "home.input" } });
});

test("ambiguous 'Add' with two clickable Add controls -> candidates", () => {
  const p = without(twoScreens(), "home.addlist");
  p.root.children[0].children = p.root.children[0].children.filter((c) => c.id !== "home.add");
  p.root.children[0].children.push({ id: "home.addtask", type: "Button", props: { label: "Add task" }, status: "draft", on: { click: [{ kind: "open", target: "x" }] }, children: [] });
  p.root.children[0].children.push({ id: "home.additem", type: "Button", props: { label: "Add item" }, status: "draft", on: { click: [{ kind: "open", target: "x" }] }, children: [] });
  const r = resolveCommand(p, initialUiState(p), { action: "click", target: "add" });
  assert.ok(!r.ok && r.reason === "ambiguous");
  assert.deepEqual(r.candidates.sort(), ["Add item (Button)", "Add task (Button)"]);
});

test("heading and button with the same label: click picks the button", () => {
  const p = twoScreens(); // includes a List titled "Add", which is not clickable
  p.root.children[0].children.push({ id: "home.h2", type: "Heading", props: { text: "Add" }, status: "draft", children: [] });
  const r = resolveCommand(p, initialUiState(p), { action: "click", target: "Add" });
  assert.ok(r.ok && r.nodeId === "home.add");
});

test("type ignores text nodes and finds the input", () => {
  const p = twoScreens();
  p.root.children[0].children.push({ id: "home.hint", type: "Text", props: { text: "Type a task here" }, status: "draft", children: [] });
  const r = resolveCommand(p, initialUiState(p), { action: "type", target: "task", value: "x" });
  assert.ok(r.ok && r.nodeId === "home.input");
});

test('"add" does not match "Address"; two-letter targets only match exactly', () => {
  const p = twoScreens();
  p.root.children[0].children = [
    { id: "a1", type: "Button", props: { label: "Address" }, status: "draft", on: { click: [{ kind: "open", target: "x" }] }, children: [] },
    { id: "a2", type: "Button", props: { label: "Go" }, status: "draft", on: { click: [{ kind: "open", target: "x" }] }, children: [] },
    { id: "a3", type: "Button", props: { label: "Padding options" }, status: "draft", on: { click: [{ kind: "open", target: "x" }] }, children: [] },
  ];
  const ui = initialUiState(p);
  assert.deepEqual(resolveCommand(p, ui, { action: "click", target: "add" }), { ok: false, reason: "not_found" });
  assert.deepEqual(resolveCommand(p, ui, { action: "click", target: "pad" }), { ok: false, reason: "not_found" });
  assert.deepEqual(resolveCommand(p, ui, { action: "click", target: "g" }), { ok: false, reason: "not_found" });
  assert.deepEqual(resolveCommand(p, ui, { action: "click", target: "go" }), { ok: true, nodeId: "a2", interaction: { kind: "open", target: "x" } });
  assert.equal((resolveCommand(p, ui, { action: "click", target: "options" }) as any).nodeId, "a3");
});

test("exact match beats contains; contains and word matches resolve; unknown is not_found", () => {
  const p = without(twoScreens(), "home.addlist");
  p.root.children[0].children.push({ id: "home.addall", type: "Button", props: { label: "Add all" }, status: "draft", on: { click: [{ kind: "open", target: "x" }] }, children: [] });
  const ui = initialUiState(p);
  assert.equal((resolveCommand(p, ui, { action: "click", target: "Add" }) as any).nodeId, "home.add");
  assert.equal((resolveCommand(p, ui, { action: "click", target: "add all" }) as any).nodeId, "home.addall");
  assert.equal((resolveCommand(p, ui, { action: "type", target: "the task box", value: "x" }) as any).nodeId, "home.input");
  assert.deepEqual(resolveCommand(p, ui, { action: "click", target: "Delete" }), { ok: false, reason: "not_found" });
  // a label on another screen is not on the current screen
  assert.deepEqual(resolveCommand(p, ui, { action: "toggle", target: "dark mode" }), { ok: false, reason: "not_found" });
});

test("navigate, back, toggle, type and focus_option map to interactions", () => {
  const p = twoScreens();
  const ui = initialUiState(p);
  assert.deepEqual(resolveCommand(p, ui, { action: "navigate", target: "settings" }), {
    ok: true, nodeId: "home.settings", interaction: { kind: "navigate", screen: "settings" },
  });
  const onSettings = { ...ui, screen: "settings" };
  assert.deepEqual(resolveCommand(p, onSettings, { action: "toggle", target: "dark mode" }), {
    ok: true, nodeId: "settings.dark", interaction: { kind: "toggle", target: "settings.dark" },
  });
  assert.deepEqual(resolveCommand(p, onSettings, { action: "back", target: "" }), {
    ok: true, nodeId: "settings.back", interaction: { kind: "navigate", screen: "home" },
  });
  assert.deepEqual(resolveCommand(p, ui, { action: "type", target: "add a task", value: "buy milk" }), {
    ok: true, nodeId: "home.input", interaction: { kind: "setValue", target: "home.input", value: "buy milk" },
  });
  assert.deepEqual(resolveCommand(p, ui, { action: "type", target: "add a task" }), { ok: false, reason: "not_found" });
  const view = { conflictId: "c1", topic: "t", variants: [{ label: "A" }, { label: "B" }] } as any;
  assert.equal(resolveCommand(p, ui, { action: "focus_option", target: "option b" }, view).ok, true);
  assert.deepEqual(resolveCommand(p, ui, { action: "focus_option", target: "C" }, view), { ok: false, reason: "not_found" });
  assert.deepEqual(resolveCommand(p, ui, { action: "focus_option", target: "A" }, null), { ok: false, reason: "not_found" });
});

async function setup() {
  const store = await openStore();
  const id = randomUUID();
  await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  await store.saveConsensus(id, emptyDoc(), twoScreens());
  let t = 1_700_000_000_000;
  const sent: StageEvent[] = [];
  const runtime = createRuntime({ store, clock: () => t, channel: { send: (_i, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 } });
  await runtime.load(id);
  const run = createUiCommandRunner({ runtime, clock: () => t });
  const snap = () => runtime(id).snapshot() as Extract<StageEvent, { type: "snapshot" }>;
  return { id, runtime, run, sent, snap, advance: (ms: number) => { t += ms; } };
}

test("command resolves against the screen the stage reports, not proto.currentScreen", async () => {
  const { id, runtime, run, sent, snap } = await setup();
  assert.equal(snap().proto.currentScreen, "home");
  handleStageMessage(runtime, id, { type: "ui_screen", screen: "settings" });
  assert.equal(snap().uiScreen, "settings");
  assert.deepEqual(run(id, { action: "toggle", target: "dark mode" }), { ok: true, visible: true });
  assert.deepEqual(sent.filter((e) => e.type === "command"), [{ type: "command", nodeId: "settings.dark", interaction: { kind: "toggle", target: "settings.dark" } }]);
  // "Add" exists only on the proto's own current screen
  assert.deepEqual(run(id, { action: "click", target: "Add" }), { ok: false, reason: "not_found" });
});

test("stage messages that are not a ui_screen for a known screen are ignored", async () => {
  const { id, runtime, snap } = await setup();
  handleStageMessage(runtime, id, { type: "ui_screen", screen: "nope" });
  handleStageMessage(runtime, id, { type: "ui_screen", screen: 5 });
  handleStageMessage(runtime, id, "junk");
  assert.equal(snap().uiScreen, "home");
});

test("ambiguous and not_found make Builder look unsure for 3 s; success does not", async () => {
  const { id, run, snap, advance } = await setup();
  assert.equal(run(id, { action: "click", target: "Delete" }).ok, false);
  assert.equal(snap().mood, "unsure");
  advance(3001);
  assert.equal(snap().mood, "listening");
  assert.equal(run(id, { action: "click", target: "Delete" }).ok, false);
  assert.equal(snap().mood, "unsure");
  advance(3001);
  assert.deepEqual(run(id, { action: "click", target: "Settings" }), { ok: true, visible: true });
  assert.equal(snap().mood, "listening");
});

test("show option B points the stage at that option; with no such option shown it is not found", async () => {
  const { id, runtime, run, sent } = await setup();
  assert.deepEqual(run(id, { action: "focus_option", target: "option B" }), { ok: false, reason: "not_found" });
  const variant = (label: string) => ({ label, summary: label, backers: [], proto: twoScreens(), focusIds: [] });
  runtime(id).showComparison({ conflictId: "c1", topic: "t", variants: [variant("A"), variant("B")] });
  sent.length = 0;
  assert.deepEqual(run(id, { action: "focus_option", target: "option b" }), { ok: true, visible: true }, "visible, so Builder says nothing");
  assert.deepEqual(sent, [{ type: "focus_option", conflictId: "c1", label: "B" }]);
  assert.deepEqual(run(id, { action: "focus_option", target: "C" }), { ok: false, reason: "not_found" });
  assert.equal(runtime(id).focusOption("C"), false);
});

test("navigate updates server uiState screen and stage receives command", async (t) => {
  await withStage(t, async ({ page, runtime, sessionId, script }) => {
    const p = twoScreens();
    await script([{ batch: { label: "Build", ops: [
      { op: "add", parentId: "app", node: p.root.children[1] },
      ...p.root.children[0].children.map((node) => ({ op: "add", parentId: "home", node })),
    ] } }]);
    await page.waitFor(`!!document.querySelector('[data-node-id="home.settings"]')`);
    const run = createUiCommandRunner({ runtime, clock: Date.now });
    assert.deepEqual(run(sessionId, { action: "navigate", target: "Settings" }), { ok: true, visible: true });
    assert.equal(runtime(sessionId).uiState().screen, "settings");
    await page.waitFor(`!!document.querySelector('[data-node-id="settings.dark"]')`);
    // the stage reports its own screen back when a click in the room changes it
    await page.eval(`document.querySelector('[data-node-id="settings.back"]').click()`);
    const deadline = Date.now() + 3000;
    while (runtime(sessionId).uiState().screen !== "home" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.equal(runtime(sessionId).uiState().screen, "home");
  });
});

test("type sets value then click Add appends", async (t) => {
  await withStage(t, async ({ page, runtime, sessionId, script }) => {
    const p = without(twoScreens(), "home.addlist");
    await script([{ batch: { label: "Build", ops: p.root.children[0].children.map((node) => ({ op: "add", parentId: "home", node })) } }]);
    await page.waitFor(`!!document.querySelector('[data-node-id="home.add"]')`);
    const run = createUiCommandRunner({ runtime, clock: Date.now });
    assert.deepEqual(run(sessionId, { action: "type", target: "task box", value: "buy milk" }), { ok: true, visible: true });
    await page.waitFor(`document.querySelector('[data-node-id="home.input"]').value === "buy milk" || document.querySelector('[data-node-id="home.input"] input')?.value === "buy milk"`);
    assert.deepEqual(run(sessionId, { action: "click", target: "Add" }), { ok: true, visible: true });
    await page.waitFor(`document.querySelector('[data-node-id="home.list"]')?.textContent.includes("buy milk")`);
    const st = runtime(sessionId).uiState();
    assert.deepEqual(st.lists["home.list"], ["buy milk"]);
    assert.equal(st.values["home.input"], "");
  });
});
