import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/store.ts";
import { buildComparisonView, createRuntime } from "../src/session/runtime.ts";
import type { StageEvent } from "../src/stage/channel.ts";
import { applyBatch, emptyPrototype, findNode } from "../src/ui/tree.ts";
import type { PatchBatch, Prototype, UiNode } from "../src/ui/schema.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import type { Conflict, ConsensusDoc } from "../src/consensus/doc.ts";
import { withStage } from "./helpers/stage.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const node = (id: string, type: string, props: UiNode["props"] = {}, children: UiNode[] = [], status: "draft" | "agreed" = "agreed"): UiNode =>
  ({ id, type: type as UiNode["type"], props, status, children });
const item = (id: string, text: string) => node(id, "ListItem", { text });

// A to-do app the room has built so far: the same batch the stage gets through the script.
const BASE: PatchBatch = {
  label: "To-do basics",
  ops: [
    { op: "update", id: "app", props: { title: "Team To-Do" } },
    { op: "add", parentId: "home", node: node("home.heading", "Heading", { text: "Today" }) },
    { op: "add", parentId: "home", node: node("home.input", "Input", { placeholder: "Add a task" }) },
    { op: "add", parentId: "home", node: node("home.list", "List", {}, [item("t1", "Book the venue"), item("t2", "Send invites"), item("t3", "Order snacks")]) },
  ],
};
const baseProto = (): Prototype => {
  const r = applyBatch(emptyPrototype("Untitled app"), BASE);
  assert.ok(r.ok);
  return r.proto;
};

const variantA: PatchBatch = {
  label: "Done tasks hidden", by: "Sara",
  ops: [{ op: "add", parentId: "home", index: 2, node: node("home.show-done", "Toggle", { label: "Show done tasks" }, [], "draft") }],
};
const variantB: PatchBatch = {
  label: "Done tasks at the bottom", by: "Amir",
  ops: [{ op: "add", parentId: "home", node: node("home.done", "Card", { title: "Done" }, [item("d1", "Pick a date"), item("d2", "Draft the agenda")], "draft") }],
};
const variantC: PatchBatch = {
  label: "Done tab", by: "Lee",
  ops: [{ op: "add", parentId: "home", index: 1, node: node("home.tabs", "Tabs", { tabs: ["To do", "Done (2)"], active: 0 }, [], "draft") }],
};
const broken: PatchBatch = { label: "Broken", ops: [{ op: "remove", id: "no-such-node" }] };

const conflict = (variants: Conflict["variants"]): Conflict =>
  ({ id: "c1", topic: "Where do done tasks go?", status: "open", openedAt: 1, variants });
const THREE = conflict([
  { label: "A", summary: "Hide done tasks behind a toggle", backers: ["Sara"], batch: variantA },
  { label: "B", summary: "Done tasks greyed at the bottom", backers: ["Amir", "Ada"], batch: variantB },
  { label: "C", summary: "A separate Done tab", backers: ["Lee"], batch: variantC },
]);
const docWith = (c: Conflict): ConsensusDoc => ({ ...emptyDoc(), phase: "converge", conflicts: [c] });

test("buildComparisonView drops invalid variants and requires ≥2", () => {
  const proto = baseProto();
  const removeOne: PatchBatch = { label: "Fewer tasks", ops: [{ op: "remove", id: "t3" }, { op: "update", id: "t1", props: { text: "Book it" } }] };
  const view = buildComparisonView(proto, conflict([
    { label: "A", summary: "Toggle", backers: ["Sara"], batch: variantA },
    { label: "B", summary: "Broken", backers: ["Bo"], batch: broken },
    { label: "C", summary: "Trim the list", backers: ["Lee"], batch: removeOne },
  ]));
  assert.ok(view);
  assert.equal(view.conflictId, "c1");
  assert.equal(view.topic, "Where do done tasks go?");
  assert.deepEqual(view.variants.map((v) => v.label), ["A", "C"], "the variant that does not apply is dropped");
  const [a, c] = view.variants;
  assert.deepEqual([a.summary, a.backers], ["Toggle", ["Sara"]]);
  assert.ok(findNode(a.proto, "home.show-done"), "each preview is the current prototype with the variant applied");
  assert.equal(findNode(c.proto, "t3"), undefined);
  assert.deepEqual(a.focusIds, ["home.show-done"]);
  // A removal is focused on the parent it left; an update on the node itself.
  assert.deepEqual(c.focusIds, ["home.list", "t1"]);
  assert.equal(findNode(proto, "home.show-done"), undefined, "the main prototype is untouched");

  // Fewer than two appliable variants: nothing to compare.
  assert.equal(buildComparisonView(proto, conflict([
    { label: "A", summary: "Toggle", backers: [], batch: variantA },
    { label: "B", summary: "Broken", backers: [], batch: broken },
  ])), null);
});

test("resolveComparison applies winner batch to main proto and records decision", () => {
  const store = openStore(":memory:");
  const s = store.createIntent("66666666-6666-6666-6666-666666666666", "https://meet.google.com/x");
  const sent: StageEvent[] = [];
  const rt = createRuntime({ store, channel: { send: (_i, ev) => sent.push(ev), sendAudio() {}, clients: () => 0 }, clock: () => 5000 })(s.id);
  assert.equal(rt.applyBatch(BASE).ok, true);
  rt.setDoc(docWith(THREE));
  const view = buildComparisonView(baseProto(), THREE);
  assert.ok(view);
  rt.showComparison(view);
  assert.equal((rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>).comparison?.variants.length, 3);

  sent.length = 0;
  assert.deepEqual(rt.resolveComparison("c1", "B"), { ok: true });
  assert.deepEqual(sent.map((e) => e.type), ["resolve", "patch", "doc"]);
  assert.deepEqual(sent[0], { type: "resolve", conflictId: "c1", winner: "B" });

  const saved = store.getConsensus(s.id)!;
  assert.ok(findNode(saved.proto, "home.done"), "the winner's batch is in the main prototype");
  assert.equal(findNode(saved.proto, "home.show-done"), undefined, "losers are not applied");
  assert.equal(findNode(saved.proto, "home.tabs"), undefined);
  assert.deepEqual(saved.doc.conflicts[0].status, "resolved");
  const decision = saved.doc.decisions.find((d) => d.id === "d-c1");
  assert.deepEqual(
    { text: decision?.text, status: decision?.status, agreedBy: decision?.agreedBy, rejected: decision?.rejectedOptions, at: decision?.decidedAt },
    { text: "Done tasks greyed at the bottom", status: "agreed", agreedBy: ["Amir", "Ada"], rejected: ["Hide done tasks behind a toggle", "A separate Done tab"], at: 5000 },
  );
  const snap = rt.snapshot() as Extract<StageEvent, { type: "snapshot" }>;
  assert.equal(snap.comparison, null, "the comparison is closed");
  assert.ok(findNode(snap.proto, "home.done"));
});

// Geometry and content of the comparison view as the stage shows it.
const READ_VIEW = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const options = [...document.querySelectorAll("#comparison .c-option")].map((o) => ({
    rect: r(o),
    label: o.querySelector(".c-label").textContent,
    labelPx: parseFloat(getComputedStyle(o.querySelector(".c-label")).fontSize),
    summary: o.querySelector(".c-summary").textContent,
    summaryPx: parseFloat(getComputedStyle(o.querySelector(".c-summary")).fontSize),
    backers: o.querySelector(".c-backers").textContent,
    preview: r(o.querySelector(".c-preview")),
    rings: [...o.querySelectorAll(".c-ring")].map((x) => ({ id: x.dataset.focusId, ...r(x) })),
    nodes: [...o.querySelectorAll(".c-preview [data-node-id]")].map((n) => n.dataset.nodeId),
  }));
  const panel = getComputedStyle(document.getElementById("panel"));
  const bot = document.querySelector("#builder .bot").getBoundingClientRect();
  return {
    topic: document.querySelector("#comparison .c-topic")?.textContent,
    hint: document.querySelector("#comparison .c-hint")?.textContent,
    view: document.querySelector("#comparison .c-view") ? r(document.querySelector("#comparison .c-view")) : null,
    options, panelOpacity: panel.opacity, dockOpacity: getComputedStyle(document.getElementById("dock")).opacity,
    placement: document.getElementById("builder").dataset.placement,
    bot: { x: bot.left, y: bot.top, w: bot.width, h: bot.height },
  };
})()`;
type ViewRead = {
  topic?: string; hint?: string; view: { x: number; y: number; w: number; h: number } | null;
  options: { rect: any; label: string; labelPx: number; summary: string; summaryPx: number; backers: string; preview: any; rings: any[]; nodes: string[] }[];
  panelOpacity: string; dockOpacity: string; placement: string; bot: { x: number; y: number; w: number; h: number };
};

// Every animation the comparison started: which properties it moves and for how long.
const COMPARISON_ANIMS = `document.getAnimations()
  .filter((a) => a.effect?.target?.closest?.("#comparison, #panel, #dock"))
  .map((a) => ({ ms: a.effect.getTiming().duration, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))]
    .filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)), css: a.transitionProperty ?? null }))`;

const inside = (r: { x: number; y: number; w: number; h: number }, o: { x: number; y: number; w: number; h: number }) =>
  r.x >= o.x - 0.5 && r.y >= o.y - 0.5 && r.x + r.w <= o.x + o.w + 0.5 && r.y + r.h <= o.y + o.h + 0.5;
const FRAME = { x: 0, y: 0, w: 1280, h: 720 };

test("comparison renders 3 labelled previews within 1280×720", async (t) => {
  await withStage(t, async ({ page, script }) => {
    const view = buildComparisonView(baseProto(), THREE);
    await script([{ batch: BASE, doc: docWith(THREE) }, { wait: 400, comparison: view }]);
    await page.waitFor(`document.querySelectorAll("#comparison .c-option").length === 3`);
    const anims = await page.eval<{ ms: number; props: string[] }[]>(COMPARISON_ANIMS);
    assert.ok(anims.some((a) => a.ms === 450), `the split runs 450 ms: ${JSON.stringify(anims)}`);
    for (const a of anims) {
      assert.ok(a.props.every((p) => p === "transform" || p === "opacity"), `only transform/opacity animate: ${JSON.stringify(a)}`);
      assert.ok(a.ms >= 250 && a.ms <= 600, `duration in 250-600 ms: ${JSON.stringify(a)}`);
    }
    await sleep(700);

    const r = await page.eval<ViewRead>(READ_VIEW);
    assert.equal(r.topic, "Where do done tasks go?");
    assert.match(r.hint ?? "", /A.*B.*C/);
    assert.deepEqual(r.view, FRAME, "the comparison spans the whole frame");
    assert.deepEqual(r.options.map((o) => o.label), ["A", "B", "C"]);
    assert.deepEqual(r.options.map((o) => o.summary), ["Hide done tasks behind a toggle", "Done tasks greyed at the bottom", "A separate Done tab"]);
    assert.deepEqual(r.options.map((o) => o.backers), ["Backed by Sara", "Backed by Amir and Ada", "Backed by Lee"]);
    for (const [i, o] of r.options.entries()) {
      assert.ok(inside(o.rect, FRAME), `option ${o.label} inside the frame: ${JSON.stringify(o.rect)}`);
      assert.ok(o.rect.w >= 380, `option ${o.label} is a third of the frame wide: ${o.rect.w}`);
      if (i) assert.ok(o.rect.x >= r.options[i - 1].rect.x + r.options[i - 1].rect.w, "options sit side by side");
      assert.ok(o.labelPx >= 40 && o.summaryPx >= 22, `readable at 720p: label ${o.labelPx}px, summary ${o.summaryPx}px`);
      assert.ok(inside(o.preview, o.rect) && o.preview.h >= 400, `preview ${JSON.stringify(o.preview)}`);
      assert.ok(o.nodes.includes("home.list"), "each preview is a live render of the prototype");
    }
    // The rings mark the part that differs, inside each preview.
    assert.deepEqual(r.options.map((o) => o.rings.map((x) => x.id)), [["home.show-done"], ["home.done"], ["home.tabs"]]);
    for (const o of r.options) for (const ring of o.rings) assert.ok(inside(ring, o.preview), `ring inside preview: ${JSON.stringify(ring)}`);
    // The panel and dock step aside; Builder stays visible, small, in a corner.
    assert.deepEqual([r.panelOpacity, r.dockOpacity], ["0", "0"]);
    assert.equal(r.placement, "corner");
    assert.ok(inside(r.bot, FRAME) && r.bot.w <= 80, `Builder small in the corner: ${JSON.stringify(r.bot)}`);
    assert.ok(r.options.every((o) => !(r.bot.x < o.rect.x + o.rect.w && r.bot.x + r.bot.w > o.rect.x && r.bot.y < o.rect.y + o.rect.h && r.bot.y + r.bot.h > o.rect.y)), "Builder does not cover an option");

    const log = await page.eval<any[]>(`window.__motionLog.filter((e) => e.fn === "showComparison")`);
    assert.deepEqual(log.map((e) => [e.conflictId, e.options]), [["c1", 3]]);
  });
});

test("resolving expands the winner into the prototype area, folds the others and restores the layout", { timeout: 40_000 }, async (t) => {
  await withStage(t, async ({ page, script }) => {
    await page.setCpuThrottle(2);
    await page.eval(`import("@renderer/clock.js").then((m) => { window.__ticks = []; m.onFrame((now) => window.__ticks.push(now)); })`);
    const view = buildComparisonView(baseProto(), THREE);
    await script([{ batch: BASE, doc: docWith(THREE), mood: "curious" }, { wait: 400, comparison: view }]);
    await page.waitFor(`document.querySelectorAll("#comparison .c-option").length === 3`);
    await sleep(700);
    await page.eval(`window.__motionLog.length = 0`);

    await script([{ resolve: { conflictId: "c1", winner: "B" } }]);
    await page.waitFor(`window.__motionLog.some((e) => e.fn === "resolveComparison")`);
    const mid = await page.eval<{ ms: number; props: string[] }[]>(COMPARISON_ANIMS);
    assert.ok(mid.some((a) => a.ms === 500), `the winner expands over 500 ms: ${JSON.stringify(mid)}`);
    for (const a of mid) {
      assert.ok(a.props.every((p) => p === "transform" || p === "opacity"), `only transform/opacity animate: ${JSON.stringify(a)}`);
      assert.ok(a.ms >= 250 && a.ms <= 600, `duration in 250-600 ms: ${JSON.stringify(a)}`);
    }
    const resolved = await page.eval<any>(`window.__motionLog.find((e) => e.fn === "resolveComparison")`);
    assert.deepEqual([resolved.winner, resolved.folded], ["B", 2]);
    // The winner is already merged underneath, so the expansion lands on the real prototype.
    assert.ok(await page.eval(`!!document.querySelector('#proto [data-node-id="home.done"]')`));

    await page.waitFor(`!document.querySelector("#comparison .c-view")`, 3000);
    await sleep(600);
    const r = await page.eval<ViewRead>(READ_VIEW);
    assert.deepEqual([r.panelOpacity, r.dockOpacity, r.placement], ["1", "1", "dock"], "the normal layout is back");
    assert.equal(await page.eval(`!!document.querySelector('#proto [data-node-id="home.show-done"]')`), false);
    // Once the comparison is gone, the merged change gets its spotlight on the prototype.
    await page.waitFor(`window.__motionLog.some((e) => e.fn === "playFocus" && e.id === "home.done")`, 3000);
    const order = await page.eval<string[]>(`window.__motionLog.map((e) => e.fn).filter((f) => f === "resolveComparison" || f === "playFocus")`);
    assert.equal(order[0], "resolveComparison");

    const ticks = await page.eval<number[]>(`window.__ticks.slice()`);
    const gaps = ticks.slice(1).map((v, i) => v - ticks[i]).sort((a, b) => a - b);
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    console.log(`comparison frame budget: ${gaps.length} ticks, p95 ${p95.toFixed(1)}ms, max ${gaps[gaps.length - 1].toFixed(1)}ms`);
    assert.ok(p95 <= 90, `tick interval p95 ${p95}ms`);
  });
});

test("a reconnect shows the open comparison; a cleared one folds away and the layout returns unchanged", async (t) => {
  await withStage(t, async ({ page, script }) => {
    const view = buildComparisonView(baseProto(), THREE);
    await script([{ batch: BASE, doc: docWith(THREE) }, { wait: 400, comparison: view }]);
    await page.waitFor(`document.querySelectorAll("#comparison .c-option").length === 3`);
    // The snapshot on reconnect carries the comparison.
    await page.eval(`window.__before = true; setTimeout(() => location.reload(), 0)`);
    await page.waitFor(`!window.__before && document.querySelectorAll("#comparison .c-option").length === 3`);
    await sleep(600);
    assert.equal(await page.eval(`document.getElementById("builder").dataset.placement`), "corner");
    await script([{ comparison: null }]);
    await page.waitFor(`!document.querySelector("#comparison .c-view")`, 3000);
    await sleep(600);
    const r = await page.eval<ViewRead>(READ_VIEW);
    assert.deepEqual([r.panelOpacity, r.dockOpacity, r.placement], ["1", "1", "dock"]);
    assert.equal(await page.eval(`document.querySelectorAll('#proto [data-node-id^="home."]').length`), 3, "the prototype is unchanged");
  });
});
