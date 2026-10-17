import { test } from "node:test";
import assert from "node:assert/strict";
import { withStage } from "./helpers/stage.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOODS = ["listening", "thinking", "building", "speaking", "curious", "unsure", "pleased"] as const;

const text = (id: string, t: string) => ({ id, type: "Text", props: { text: t }, status: "agreed", children: [] });
const decision = (id: string, t: string, status: string, extra: object = {}) =>
  ({ id, text: t, status, proposedBy: "Ada", agreedBy: [], affects: [], rejectedOptions: [], ...extra });
const doc = (decisions: unknown[], openQuestions: unknown[] = []) =>
  ({ phase: "converge", app: {}, decisions, openQuestions, conflicts: [], nextUp: [] });

// Every part of the character's art: its settled look (opacity, transform) and what it is doing
// (running animations). Values that an animation is changing are left out so a read is stable.
const LOOK = `(() => {
  const out = {};
  for (const el of document.querySelectorAll(".builder [class*='bot-']")) {
    if (el.classList.contains("bot-label")) continue;
    const cs = getComputedStyle(el);
    const anims = el.getAnimations().map((a) => a.animationName || "js").sort();
    out[el.className] = { anims, opacity: anims.length ? "anim" : cs.opacity, transform: anims.length ? "anim" : cs.transform };
  }
  return out;
})()`;
type Look = Record<string, { anims: string[]; opacity: string; transform: string }>;

// translateY and scaleY of a 2D matrix() (or "none").
const matrix = (m: string) => {
  const v = m === "none" ? [1, 0, 0, 1, 0, 0] : m.slice(7, -1).split(",").map(Number);
  return { scaleY: v[3], y: v[5] };
};

test("each mood sets data-mood and distinct computed styles", async (t) => {
  await withStage(t, async ({ page, script }) => {
    assert.equal(await page.eval(`document.querySelector(".builder").dataset.mood`), "listening", "snapshot mood");
    const looks = new Map<string, Look>();
    const labels = new Map<string, string>();
    for (const mood of MOODS) {
      await script([{ mood }]);
      await page.waitFor(`document.querySelector(".builder").dataset.mood === "${mood}"`, 2000);
      await sleep(600); // mood transitions are 250-400 ms
      looks.set(mood, await page.eval<Look>(LOOK));
      labels.set(mood, await page.eval<string>(`document.querySelector(".bot-label").textContent`));
      if (mood === "speaking") {
        const scaleAt = async (level: number) => {
          await page.eval(`window.stageCharacter.setMouth(${level})`);
          await sleep(400);
          return matrix(await page.eval<string>(`getComputedStyle(document.querySelector(".bot-mouth.open")).transform`)).scaleY;
        };
        const shut = await scaleAt(0);
        const open = await scaleAt(1);
        assert.ok(open > shut + 0.4, `setMouth drives the mouth: ${shut} -> ${open}`);
        await scaleAt(0);
      }
    }

    // Seven different looks, and seven different labels.
    const keys = MOODS.map((m) => JSON.stringify(looks.get(m)));
    for (let i = 0; i < MOODS.length; i++) {
      for (let j = i + 1; j < MOODS.length; j++) assert.notEqual(keys[i], keys[j], `${MOODS[i]} and ${MOODS[j]} look the same`);
    }
    assert.equal(new Set(labels.values()).size, MOODS.length, JSON.stringify([...labels]));

    // Each mood shows what the mockup says it shows.
    const part = (mood: string, cls: string) => {
      const p = looks.get(mood)![cls];
      assert.ok(p, `${mood}: no ${cls} in ${Object.keys(looks.get(mood)!)}`);
      return p;
    };
    const eyeY = (mood: string, side: "l" | "r") => matrix(part(mood, `bot-eye ${side}`).transform).y;
    assert.ok(eyeY("thinking", "l") < -4 && eyeY("thinking", "r") < -4, "thinking: eyes up");
    assert.ok(part("thinking", "bot-bulb").anims.length > 0 && part("listening", "bot-bulb").anims.length === 0, "thinking: antenna blinks");
    for (const b of ["bot-block b1", "bot-block b2", "bot-block b3"]) {
      assert.ok(part("building", b).anims.length > 0, `building: ${b} hops`);
      assert.equal(part("listening", b).opacity, "0", `listening: ${b} hidden`);
    }
    assert.equal(part("speaking", "bot-mouth open").opacity, "1", "speaking: open mouth");
    assert.ok(eyeY("curious", "r") < eyeY("curious", "l") - 4, "curious: one raised eye");
    assert.equal(part("unsure", "bot-mouth flat").opacity, "1", "unsure: flat mouth");
    assert.notEqual(part("unsure", "bot-mouth flat").transform, "none", "unsure: tilted mouth");
    assert.equal(part("pleased", "bot-arc l").opacity, "1", "pleased: happy eyes");
    assert.equal(part("listening", "bot-arc l").opacity, "0");
  });
});

test("pleased plays a small bounce", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ mood: "pleased" }]);
    await page.waitFor(`document.querySelector(".builder").dataset.mood === "pleased"`, 2000);
    const bounce = await page.eval<{ name: string; duration: number }[]>(
      `document.querySelector(".bot-act").getAnimations().map((a) => ({ name: a.animationName, duration: a.effect.getTiming().duration }))`);
    assert.equal(bounce.length, 1, JSON.stringify(bounce));
    assert.ok(bounce[0].duration >= 250 && bounce[0].duration <= 600, `bounce ${bounce[0].duration}ms`);
  });
});

test("placement switches to dock when first node is added", async (t) => {
  await withStage(t, async ({ page, script }) => {
    type Box = { x: number; y: number; w: number; h: number };
    const box = (sel: string) => page.eval<Box>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const inside = (a: Box, b: Box, pad = 2) => a.x >= b.x - pad && a.y >= b.y - pad && a.x + a.w <= b.x + b.w + pad && a.y + a.h <= b.y + b.h + pad;

    assert.equal(await page.eval(`document.querySelector(".builder").dataset.placement`), "center");
    const canvas = await box("#canvas");
    const head = await box(".bot-head");
    assert.ok(Math.abs(head.x + head.w / 2 - (canvas.x + canvas.w / 2)) < 4, `centred on the prototype area: ${JSON.stringify({ head, canvas })}`);
    assert.ok(head.w > 160, `takes centre stage at a large size: ${head.w}px`);

    await script([{ batch: { label: "First", ops: [{ op: "add", parentId: "home", node: text("t1", "Hello") }] } }]);
    await page.waitFor(`document.querySelector(".builder").dataset.placement === "dock"`, 2000);
    const anims = await page.eval<{ props: string[]; duration: number; easing: string }[]>(`document.querySelector(".bot").getAnimations().map((a) => ({
      props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)),
      duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing }))`);
    assert.deepEqual(anims, [{ props: ["transform"], duration: 500, easing: "ease-out" }]);
    await sleep(700);
    assert.equal(await page.eval(`document.querySelector(".bot").getAnimations().length`), 0);
    const dock = await box("#dock");
    assert.ok(inside(await box(".bot-head"), dock), "head in the dock");
    assert.ok(inside(await box(".bot-label"), dock), "label in the dock");
    assert.equal(await page.eval(`document.getElementById("placeholder").hidden`), true);

    // Back to centre stage once nothing is left on the screens.
    await script([{ batch: { label: "Clear", ops: [{ op: "remove", id: "t1" }] } }]);
    await page.waitFor(`document.querySelector(".builder").dataset.placement === "center"`, 2000);
  });
});

test("pending decision shows in Pending and moves to Agreed on doc update with settled animation", async (t) => {
  await withStage(t, async ({ page, script }) => {
    const now = Date.now();
    const agreed = decision("d1", "Quick-add at top", "agreed", { agreedBy: ["Bo"], decidedAt: now });
    const question = { id: "q1", text: "Where do done tasks go?", raisedBy: "Sara", since: now, lastEngagedAt: now };
    await script([{ doc: doc([agreed, decision("d2", "Dark theme", "pending", { pendingSince: now - 10_000 })], [question]) }]);
    await page.waitFor(`document.querySelector('#pending [data-decision-id="d2"]')`, 2000);

    const panel = await page.eval<{ header: string; agreed: string[]; pending: string[]; open: string[]; progress: number[] }>(`(() => {
      const texts = (id) => [...document.querySelectorAll("#" + id + " .item .txt")].map((e) => e.textContent);
      const ring = document.querySelector('#pending [data-decision-id="d2"] .cd');
      return {
        header: document.querySelector("header").textContent.replace(/\\s+/g, " ").trim(),
        agreed: texts("agreed"), pending: texts("pending"), open: texts("open"),
        progress: [...ring.querySelectorAll("i")].flatMap((i) => i.getAnimations()).map((a) => a.effect.getComputedTiming().progress),
      };
    })()`);
    assert.equal(panel.header, "Builder · Converge");
    assert.deepEqual([panel.agreed, panel.pending, panel.open], [["Quick-add at top"], ["Dark theme"], ["Where do done tasks go?"]]);
    // The ring counts down the 30 s no-objection window from pendingSince: a third has elapsed.
    assert.equal(panel.progress.length, 2, "two ring halves animate");
    for (const p of panel.progress) assert.ok(p > 0.3 && p < 0.45, `ring progress ${p}`);

    await page.eval(`window.__d2 = document.querySelector('[data-decision-id="d2"]'); window.__motionLog = []`);
    await script([{ doc: doc([agreed, decision("d2", "Dark theme", "agreed", { decidedAt: now })], [question]) }]);
    await page.waitFor(`document.querySelector('#agreed [data-decision-id="d2"]')`, 2000);
    const moved = await page.eval<{ same: boolean; pending: number; ring: boolean; agreed: string[] }>(`(() => {
      const el = document.querySelector('#agreed [data-decision-id="d2"]');
      return { same: el === window.__d2, pending: document.querySelectorAll("#pending [data-decision-id]").length,
               ring: !!el.querySelector(".cd"), agreed: [...document.querySelectorAll("#agreed .item .txt")].map((e) => e.textContent) };
    })()`);
    assert.deepEqual(moved, { same: true, pending: 0, ring: false, agreed: ["Quick-add at top", "Dark theme"] });
    await page.waitFor(`window.__motionLog.some((e) => e.fn === "playSettled") && document.querySelector("#panel .m-settle")`, 2000);
    const style = await page.eval<string>(`getComputedStyle(document.querySelector('[data-decision-id="d2"]')).borderTopStyle`);
    assert.equal(style, "solid", "agreed items are solid");
  });
});

test("caption bar labels agent lines Builder, and human speech pulses the listening rings", async (t) => {
  await withStage(t, async ({ page, script }) => {
    const rings = `[...document.querySelectorAll(".bot-ring")].filter((r) => r.getAnimations().length > 0).length`;
    assert.equal(await page.eval(rings), 0, "rings rest while nobody speaks");
    await script([{ caption: { speaker: "Ada", text: "I think we need due dates", partial: false, isAgent: false } }]);
    await page.waitFor(`${rings} === 2`, 2000);
    await script([{ caption: { speaker: "bot", text: "Want quick-add at the top?", partial: false, isAgent: true } }]);
    await page.waitFor(`document.querySelectorAll("#captions .cap").length === 2`, 2000);
    const caps = await page.eval<{ who: string; agent: boolean; text: string }[]>(`[...document.querySelectorAll("#captions .cap")].map((c) => ({
      who: c.querySelector("b").textContent, agent: c.classList.contains("is-agent"), text: c.textContent }))`);
    assert.deepEqual(caps.map((c) => [c.who, c.agent]), [["Ada", false], ["Builder", true]]);
    assert.match(caps[1].text, /Want quick-add at the top\?/);
    await page.waitFor(`${rings} === 0`, 4000); // the rings settle once the room goes quiet
  });
});
