import { test } from "node:test";
import assert from "node:assert/strict";
import { withStage } from "./helpers/stage.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const text = (id: string, t: string, status = "agreed") => ({ id, type: "Text", props: { text: t }, status, children: [] });
const add = (parentId: string, node: unknown, index?: number) => (index === undefined ? { op: "add", parentId, node } : { op: "add", parentId, index, node });

test("changes on another screen trigger screen transition before focus", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([
      { batch: { label: "Home and About", by: "Ada", ops: [
        add("home", text("home.t", "Home screen")),
        add("app", { id: "about", type: "Screen", props: { title: "About" }, status: "draft", children: [text("about.t", "About this app")] }),
      ] } },
    ]);
    await page.waitFor(`document.querySelector('[data-node-id="about.t"]')`);
    await sleep(1700); // let the first spotlight finish
    await page.eval(`window.__motionLog = []`);

    // A change lands on the About screen while Home is showing.
    await script([{ batch: { label: "Added: contact line", by: "Bo", ops: [
      { op: "set_screen", screenId: "about" },
      add("about", text("about.contact", "Contact us")),
    ] } }]);
    await page.waitFor(`(window.__motionLog || []).some((e) => e.fn === "playFocus")`, 5000);
    const log = await page.eval<{ fn: string; id?: string; from?: string; to?: string; label?: string; t: number }[]>(`window.__motionLog`);
    const tr = log.find((e) => e.fn === "transitionScreen");
    const focus = log.find((e) => e.fn === "playFocus");
    assert.ok(tr, `no transitionScreen in ${JSON.stringify(log)}`);
    assert.deepEqual([tr.from, tr.to], ["home", "about"]);
    assert.equal(focus!.id, "about.contact");
    assert.equal(focus!.label, "Added: contact line · Bo");
    assert.ok(focus!.t - tr.t >= 400, `focus started ${focus!.t - tr.t}ms after the 450ms slide began`);
    const shown = await page.eval<{ home: boolean; about: boolean }>(`({
      home: document.querySelector('[data-node-id="home"]').getClientRects().length > 0,
      about: document.querySelector('[data-node-id="about"]').getClientRects().length > 0 })`);
    assert.deepEqual(shown, { home: false, about: true });
  });
});

test("set_screen brings the stage back after it followed a change to another screen", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Screens", ops: [
      add("home", text("home.t", "Home screen")),
      add("app", { id: "about", type: "Screen", props: {}, status: "agreed", children: [] }),
    ] } }]);
    await script([{ batch: { label: "About text", ops: [add("about", text("about.t", "About"))] } }]); // follows to About
    const shown = (id: string) => page.eval<boolean>(`document.querySelector('[data-node-id="${id}"]').getClientRects().length > 0`);
    await page.waitFor(`document.querySelector('[data-node-id="about"]').getClientRects().length > 0`);
    await script([{ batch: { label: "Back", ops: [{ op: "set_screen", screenId: "home" }] } }]); // currentScreen was already home
    await page.waitFor(`document.querySelector('[data-node-id="home"]').getClientRects().length > 0`, 2000);
    assert.equal(await shown("about"), false);
  });
});

test("reconcile motion: enter, exit, move, cross-fade, settle use transform/opacity only", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [
      add("home", text("a", "Alpha")), add("home", text("b", "Bravo", "draft")), add("home", text("c", "Charlie")),
    ] } }]);
    await page.waitFor(`document.querySelector('[data-node-id="c"]')`);
    // Snapshot the animations started by each patch, synchronously, as the patch is drawn.
    await page.eval(`(() => {
      window.__anims = [];
      const orig = window.stageEvent;
      window.stageEvent = (ev) => {
        const before = new Set(document.getAnimations());
        orig(ev);
        if (ev.type !== "patch") return;
        for (const a of document.getAnimations()) {
          if (before.has(a)) continue;
          const kf = a.effect.getKeyframes();
          const el = a.effect.target;
          window.__anims.push({
            props: [...new Set(kf.flatMap((k) => Object.keys(k)))].filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)),
            duration: a.effect.getTiming().duration,
            easing: [...new Set(kf.map((k) => k.easing))].concat(a.effect.getTiming().easing),
            cls: el.className, id: el.dataset ? el.dataset.nodeId || "" : "",
          });
        }
      };
    })()`);
    await sleep(200);
    // The stage socket handler calls the module-scoped onEvent, so drive patches through the hook.
    const patch = (proto: unknown, changes: unknown[]) => page.eval(`window.stageEvent({ type: "patch", proto: ${JSON.stringify(proto)}, changes: ${JSON.stringify(changes)} })`);
    const base = await page.eval<any>(`JSON.parse(JSON.stringify(window.stageProto()))`);
    const home = () => base.root.children.find((s: any) => s.id === "home");

    home().children.push(text("d", "Delta"));
    await patch(base, [{ kind: "added", id: "d", label: "Add", by: "Ada" }]);
    const [a0] = home().children.splice(0, 1);
    home().children.push(a0); // move Alpha to the end
    await patch(base, [{ kind: "moved", id: "a", label: "Move", by: "Ada" }]);
    home().children.find((n: any) => n.id === "c").props.text = "Charlie!";
    await patch(base, [{ kind: "updated", id: "c", label: "Edit", by: "Ada" }]);
    home().children.find((n: any) => n.id === "b").status = "agreed";
    await patch(base, [{ kind: "updated", id: "b", label: "Agreed", by: "Ada" }]);
    home().children = home().children.filter((n: any) => n.id !== "d");
    await patch(base, [{ kind: "removed", id: "d", label: "Remove", by: "Ada" }]);

    const anims = await page.eval<{ props: string[]; duration: number; easing: string[]; cls: string; id: string }[]>(`window.__anims`);
    assert.ok(anims.length >= 5, JSON.stringify(anims));
    for (const a of anims) {
      for (const p of a.props) assert.ok(p === "transform" || p === "opacity", `animates ${p}: ${JSON.stringify(a)}`);
      assert.ok(a.duration >= 250 && a.duration <= 1500, `duration ${a.duration}`);
      for (const e of a.easing) assert.ok(e === "ease-out" || e === "linear", `easing ${e}`);
    }
    const has = (pred: (a: (typeof anims)[number]) => boolean, what: string) => assert.ok(anims.some(pred), `${what}: ${JSON.stringify(anims)}`);
    has((a) => a.id === "d" && a.duration === 350 && a.props.includes("opacity"), "enter 350ms on added node");
    has((a) => a.id === "b" && a.duration === 350 && a.props.includes("transform"), "FLIP glide on a node shifted by the move");
    has((a) => /m-ghost/.test(a.cls) && a.duration === 250, "cross-fade 250ms for the prop update");
    has((a) => /m-settle/.test(a.cls) && a.duration === 400, "settled outline morph 400ms");
    has((a) => /m-ghost/.test(a.cls) && a.duration === 300, "exit collapse 300ms");

    await sleep(700);
    const left = await page.eval<{ ghosts: number; d: boolean; dashed: string }>(`({
      ghosts: document.querySelectorAll(".m-ghost").length,
      d: !!document.querySelector('[data-node-id="d"]'),
      dashed: getComputedStyle(document.querySelector('[data-node-id="b"]')).outlineStyle })`);
    assert.deepEqual(left, { ghosts: 0, d: false, dashed: "none" });
  });
});

test("a removal is spotlit on the parent it left, with its label", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [add("home", text("a", "Alpha")), add("home", text("b", "Bravo"))] } }]);
    await sleep(1700);
    await page.eval(`window.__motionLog = []`);
    await script([{ batch: { label: "Removed: Alpha", by: "Ada", ops: [{ op: "remove", id: "a" }] } }]);
    await page.waitFor(`window.__motionLog.some((e) => e.fn === "playFocus")`, 3000);
    const focus = await page.eval<{ id: string; label: string }>(`window.__motionLog.find((e) => e.fn === "playFocus")`);
    assert.deepEqual({ id: focus.id, label: focus.label }, { id: "home", label: "Removed: Alpha · Ada" });
  });
});

test("voice command: pointer glides and presses before the action runs", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Nav", ops: [
      add("home", { id: "home.go", type: "Button", props: { label: "About" }, status: "agreed", on: { click: [{ kind: "navigate", screen: "about" }] }, children: [] }),
      add("app", { id: "about", type: "Screen", props: {}, status: "agreed", children: [text("about.t", "About")] }),
    ] } }]);
    await page.waitFor(`document.querySelector('[data-node-id="home.go"]')`);
    const t0 = await page.eval<number>(`(() => {
      window.stageEvent({ type: "command", nodeId: "home.go", interaction: { kind: "navigate", screen: "about" } });
      return performance.now();
    })()`);
    const early = await page.eval<{ about: boolean; pointer: boolean }>(`({
      about: document.querySelector('[data-node-id="about"]').getClientRects().length > 0,
      pointer: !!document.querySelector(".m-pointer") })`);
    assert.deepEqual(early, { about: false, pointer: true }, "the action waits for the pointer");
    await page.waitFor(`document.querySelector('[data-node-id="about"]').getClientRects().length > 0`, 3000);
    const log = await page.eval<{ fn: string; t: number; phase?: string }[]>(`window.__motionLog`);
    const press = log.find((e) => e.fn === "animatePointer" && e.phase === "press");
    assert.ok(press && press.t - t0 >= 450, `press at ${press && press.t - t0}ms`);
  });
});

test("a voice navigate points at the nav item", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Screens", ops: [
      add("home", text("home.t", "Home")),
      add("app", { id: "about", type: "Screen", props: { title: "About" }, status: "agreed", children: [text("about.t", "About")] }),
    ] } }]);
    await page.waitFor(`document.querySelector('[data-nav-screen="about"]')`);
    // The command targets the Screen itself (no control on Home navigates there): the pointer goes to its nav item.
    await page.eval(`window.stageEvent({ type: "command", nodeId: "about", interaction: { kind: "navigate", screen: "about" } })`);
    await page.waitFor(`document.querySelector('[data-node-id="about"]').getClientRects().length > 0`, 3000);
    const r = await page.eval<{ pointer: string; x: number; y: number }>(`(() => {
      const r = document.querySelector('[data-nav-screen="about"]').getBoundingClientRect();
      return { pointer: document.querySelector(".m-pointer").style.transform, x: Math.round(r.left + Math.min(r.width / 2, 48)), y: Math.round(r.top + r.height / 2) };
    })()`);
    assert.equal(r.pointer, `translate(${r.x}px, ${r.y}px)`);
  });
});

test("pending region shows a shimmer placeholder and clears it", async (t) => {
  await withStage(t, async ({ page }) => {
    await page.eval(`window.stageEvent({ type: "pending_region", parentId: "home" })`);
    const shown = await page.eval<{ inHome: boolean; shimmer: number }>(`(() => {
      const ph = document.querySelector(".m-pending");
      return { inHome: !!ph && document.querySelector('[data-node-id="home"]').contains(ph),
               shimmer: document.getAnimations().filter((a) => a.effect.target.classList.contains("m-shimmer")).length };
    })()`);
    assert.deepEqual(shown, { inHome: true, shimmer: 1 });
    await page.eval(`window.stageEvent({ type: "pending_region", parentId: null })`);
    await page.waitFor(`!document.querySelector(".m-pending")`, 2000);
  });
});

test("frame budget: a burst of 10 focus moments (capped queue) holds the 15fps clock", { timeout: 60_000 }, async (t) => {
  await withStage(t, async ({ page, script }) => {
    await page.setCpuThrottle(2);
    await page.eval(`import("@renderer/clock.js").then((m) => { window.__ticks = []; m.onFrame((now) => window.__ticks.push(now)); })`);
    const steps = Array.from({ length: 10 }, (_, i) => ({ wait: 30, batch: { label: `Added: item ${i + 1}`, by: i % 2 ? "Bo" : "Ada", ops: [
      add("home", text(`item-${i}`, `Item number ${i + 1}`, i % 3 ? "agreed" : "draft")),
    ] } }));
    // The character animates throughout: building (blocks hop) with a pending countdown ring.
    const pending = { id: "d1", text: "Dark theme", status: "pending", proposedBy: "Ada", agreedBy: [], pendingSince: Date.now(), affects: [], rejectedOptions: [] };
    await script([{ mood: "building", doc: { phase: "converge", app: {}, decisions: [pending], openQuestions: [], conflicts: [], nextUp: [] } }, ...steps]);
    await sleep(15_000);
    const r = await page.eval<{ ticks: number[]; focus: number; played: string[]; mood: string; hopping: number }>(`(() => {
      const played = window.__motionLog.filter((e) => e.fn === "playFocus").map((e) => e.id);
      const hopping = [...document.querySelectorAll(".bot-block")].filter((b) => b.getAnimations().length > 0).length;
      return { ticks: window.__ticks.slice(), focus: played.length, played, mood: document.querySelector(".builder").dataset.mood, hopping };
    })()`);
    assert.deepEqual({ mood: r.mood, hopping: r.hopping }, { mood: "building", hopping: 3 }, "the character animates during the burst");
    const gaps = r.ticks.slice(1).map((v, i) => v - r.ticks[i]).sort((a, b) => a - b);
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    const max = gaps[gaps.length - 1];
    console.log(`frame budget: ${gaps.length} ticks, p95 ${p95.toFixed(1)}ms, max ${max.toFixed(1)}ms, ${r.focus} focus moments`);
    assert.ok(gaps.length >= 200, `only ${gaps.length} ticks in 15s`);
    assert.ok(p95 <= 90, `tick interval p95 ${p95}ms`);
    // The burst is capped: the one playing plus at most 3 pending, the newest kept.
    assert.equal(r.focus, 4, `played ${JSON.stringify(r.played)}`);
    assert.deepEqual(r.played.slice(1), ["item-7", "item-8", "item-9"]);
  });
});

const RECTS = (sel: Record<string, string>) => `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  return Object.fromEntries(Object.entries(${JSON.stringify(sel)}).map(([k, s]) => [k, box(document.querySelector(s))]));
})()`;
type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the spotlight label sits where it covers no other text instead of on the content above", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [add("home", { id: "home.add", type: "Button", props: { label: "Add" }, status: "agreed", children: [] })] } }]);
    await sleep(1700);
    await script([{ batch: { label: "Added: due date", by: "Amir", ops: [add("home", { id: "home.due", type: "Input", props: { label: "Due", placeholder: "Fri" }, status: "draft", children: [] })] } }]);
    await page.waitFor(`!!document.querySelector(".m-focus .m-label")`, 3000);
    await sleep(450); // the label's own 350 ms entrance has played
    const r = await page.eval<Record<string, Box>>(RECTS({ label: ".m-focus .m-label", ring: ".m-focus .m-ring", button: '[data-node-id="home.add"]', canvas: "#proto" }));
    assert.ok(!overlaps(r.label, r.button), `the label leaves the Add button visible: ${JSON.stringify(r)}`);
    assert.ok(!overlaps(r.label, r.ring), "and the change itself");
    assert.ok(r.label.y + r.label.h <= r.ring.y, "still right above the change");
    assert.ok(r.label.x >= r.canvas.x && r.label.x + r.label.w <= r.canvas.x + r.canvas.w, "on the canvas");
  });
});

test("one 20 px draft tag per draft region: a draft inside a draft shows neither tag nor outline", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [
      add("home", { id: "home.card", type: "Card", props: { title: "Quick add" }, status: "draft", children: [
        { id: "home.card.input", type: "Input", props: { placeholder: "Add a task" }, status: "draft", children: [] },
      ] }),
      add("home", { id: "home.list", type: "List", props: {}, status: "agreed", children: [
        { id: "home.t1", type: "ListItem", props: { text: "Send invites" }, status: "draft", children: [] },
      ] }),
    ] } }]);
    await page.waitFor(`!!document.querySelector('[data-node-id="home.t1"]')`);
    const read = await page.eval<Record<string, { outline: string; tag: string; px: number }>>(`Object.fromEntries(["home.card", "home.card.input", "home.list", "home.t1"].map((id) => {
      const el = document.querySelector('[data-node-id="' + id + '"]');
      const tag = getComputedStyle(el, "::after");
      return [id, { outline: getComputedStyle(el).outlineStyle, tag: tag.content, px: parseFloat(tag.fontSize) }];
    }))`);
    assert.equal(read["home.card"].outline, "dashed");
    assert.match(read["home.card"].tag, /draft/);
    assert.ok(read["home.card"].px >= 20, `tag ${read["home.card"].px}px`);
    assert.deepEqual([read["home.card.input"].outline, read["home.card.input"].tag], ["none", "none"], "inside a draft: no tag, no outline of its own");
    assert.equal(read["home.list"].outline, "none", "agreed");
    assert.equal(read["home.t1"].outline, "dashed", "a draft inside an agreed node keeps both");
    assert.match(read["home.t1"].tag, /draft/);
  });
});

// A theme patch as the stage receives it: the current prototype with the given accent slot, and its change.
type Slot = { value: string; status: string; decisionId?: string; previous: string };
const themePatch = (slot: Slot, label: string, warmth?: Slot) => `(() => {
  const p = JSON.parse(JSON.stringify(window.stageProto()));
  const s = (v) => ({ value: v, status: "agreed", previous: v });
  p.theme = { accent: ${JSON.stringify(slot)}, warmth: ${warmth ? JSON.stringify(warmth) : `s("neutral")`}, radius: s("soft"), density: s("regular") };
  window.stageEvent({ type: "patch", proto: p, changes: [{ kind: "theme", id: "app", label: ${JSON.stringify(label)}, by: "Sara" }] });
})()`;
const GOLD_DRAFT = { value: "gold", status: "draft", decisionId: "d1", previous: "slate" };

test("a theme value change fades the old canvas out", async (t) => {
  await withStage(t, async ({ page, script }) => {
    // A short screen and a background (warmth) change: the copy must cover the whole canvas, not just the content.
    await script([{ batch: { label: "Start", ops: [add("home", text("a", "Alpha"))] } }]);
    await sleep(1700); // let the first spotlight finish
    await page.eval(`window.__motionLog = []`);
    const right = await page.eval<{ fades: number; ids: number; accent: string; snapAccent: string; aligned: string[]; covers: string[]; short: boolean }>(`(() => {
      const canvas = document.getElementById("proto");
      const content = document.querySelector('[data-node-id="a"]').getBoundingClientRect();
      ${themePatch(GOLD_DRAFT, "Proposed: gold accent", { value: "warm", status: "draft", decisionId: "d1", previous: "neutral" })};
      const fade = document.querySelector(".m-theme-fade");
      const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(); };
      const c = canvas.getBoundingClientRect();
      return {
        short: content.bottom < c.bottom - 200,
        aligned: fade ? [box(fade.firstElementChild), box(document.querySelector('[data-node-id="app"]'))] : [],
        covers: fade ? [box(fade), [c.left, c.top, c.width, c.height].map(Math.round).join()] : [],
        fades: document.querySelectorAll(".m-theme-fade").length,
        ids: fade ? fade.querySelectorAll("[data-node-id]").length + (fade.hasAttribute("data-node-id") ? 1 : 0) : -1,
        accent: document.querySelector('[data-node-id="app"]').style.getPropertyValue("--b-accent"),
        snapAccent: fade ? fade.querySelector(".b-node").style.getPropertyValue("--b-accent") : "",
      };
    })()`);
    assert.equal(right.fades, 1);
    assert.equal(right.ids, 0, "the snapshot carries no node ids");
    assert.ok(right.short, "the content ends well above the canvas bottom");
    assert.equal(right.aligned[0], right.aligned[1], "the copied App sits exactly over the live one, full height");
    assert.equal(right.covers[0], right.covers[1], "the copy covers the whole canvas");
    assert.notEqual(right.snapAccent, right.accent, "the snapshot keeps the old theme over the new one");
    const anims = await page.eval<{ props: string[]; duration: number; easing: string }[]>(`document.getAnimations()
      .filter((a) => a.effect.target.classList.contains("m-theme-fade"))
      .map((a) => ({ props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)), duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing }))`);
    assert.deepEqual(anims, [{ props: ["opacity"], duration: 450, easing: "ease-out" }]);
    await sleep(600);
    assert.equal(await page.eval<number>(`document.querySelectorAll(".m-theme-fade").length`), 0, "gone once faded");
    await page.waitFor(`window.__motionLog.some((e) => e.fn === "playFocus")`, 3000);
    await sleep(300);
    const focus = await page.eval<{ id: string; label: string }[]>(`window.__motionLog.filter((e) => e.fn === "playFocus")`);
    assert.deepEqual(focus.map((f) => [f.id, f.label]), [["app", "Proposed: gold accent · Sara"]]);
  });
});

test("a settled theme plays the agreed frame", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [add("home", text("a", "Alpha"))] } }]);
    await page.eval(themePatch(GOLD_DRAFT, "Proposed: gold accent"));
    await sleep(700);
    const r = await page.eval<{ settles: number; fades: number; anims: { props: string[]; duration: number }[] }>(`(() => {
      ${themePatch({ ...GOLD_DRAFT, status: "agreed" }, "Agreed: gold accent")};
      return {
        settles: document.querySelectorAll(".m-theme-settle").length,
        fades: document.querySelectorAll(".m-theme-fade").length,
        anims: document.getAnimations().filter((a) => a.effect.target.closest(".m-theme-settle")).map((a) => ({
          props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)),
          duration: a.effect.getTiming().duration })),
      };
    })()`);
    assert.equal(r.settles, 1);
    assert.equal(r.fades, 0, "the values did not change, so nothing fades");
    assert.ok(r.anims.length >= 1);
    for (const a of r.anims) {
      for (const p of a.props) assert.ok(p === "transform" || p === "opacity", `animates ${p}`);
      assert.equal(a.duration, 400);
    }
    await page.waitFor(`!document.querySelector(".m-theme-settle")`, 3000);
  });
});

test("no theme fade while covered", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [add("home", text("a", "Alpha"))] } }]);
    await page.eval(`(() => {
      const p = window.stageProto();
      const variant = (label) => ({ label, summary: "Option " + label, backers: ["Ada"], proto: p, focusIds: [] });
      window.stageEvent({ type: "comparison", view: { conflictId: "c1", topic: "Accent", variants: [variant("A"), variant("B")] } });
    })()`);
    await sleep(100);
    const r = await page.eval<{ fades: number; settles: number; accent: string }>(`(() => {
      ${themePatch(GOLD_DRAFT, "Proposed: gold accent")};
      const fades = document.querySelectorAll(".m-theme-fade").length;
      ${themePatch({ ...GOLD_DRAFT, status: "agreed" }, "Agreed: gold accent")};
      return { fades, settles: document.querySelectorAll(".m-theme-settle").length,
        accent: document.querySelector('#proto [data-node-id="app"]').style.getPropertyValue("--b-accent") };
    })()`);
    assert.deepEqual({ fades: r.fades, settles: r.settles }, { fades: 0, settles: 0 });
    assert.ok(r.accent, "the prototype is still drawn, without motion");
    assert.deepEqual(page.logs.filter((l) => l.startsWith("console.error")), []);
  });
});
