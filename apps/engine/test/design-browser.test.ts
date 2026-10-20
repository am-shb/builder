// The component library in headless Chrome at the stage's 900x720 canvas: every catalog type renders, nothing
// overflows sideways, no text is below 14px, and nothing throws. Screenshots are saved for human review.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChrome } from "./helpers/chrome.ts";
import type { Page } from "./helpers/chrome.ts";
import { COMPONENT_TYPES } from "../public/renderer/catalog.js";

const proto: any = JSON.parse(readFileSync(new URL("./fixtures/gallery-proto.json", import.meta.url), "utf8"));
const SCREENS: string[] = proto.root.children.map((s: { id: string }) => s.id);
const WIDTH = 900;
const HEIGHT = 720;

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=/renderer/theme.css>
<style>html { scrollbar-width: none; } body { margin: 0; } #root { display: grid; width: ${WIDTH}px; min-height: ${HEIGHT}px; }</style>
<script type=importmap>{"imports":{"@renderer/":"/renderer/"}}</script>
<div id=root></div>
<script type=module>
import { renderTree, initialUiState } from "@renderer/render.js";
import { bindInteractions } from "@renderer/interact.js";
const root = document.getElementById("root");
const proto = await (await fetch("/proto.json")).json();
window.proto = proto;
let state = initialUiState(proto);
window.draw = () => { window.nodes = renderTree(root, proto, state); };
window.show = (screen, open = {}) => { state = { ...state, screen, open }; window.draw(); window.scrollTo(0, 0); };
bindInteractions(root, () => proto, () => state, (s) => { state = s; window.draw(); });
window.draw();
window.ready = true;
</script>`;

async function withGalleryServer(fn: (url: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    if (req.url === "/") return void res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
    if (req.url === "/proto.json") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(proto));
    const m = req.url?.match(/^\/renderer\/((?:components\/)?[\w.-]+\.(js|css))$/);
    if (m) {
      try {
        const body = readFileSync(new URL(`../public/renderer/${m[1]}`, import.meta.url));
        return void res.writeHead(200, { "Content-Type": m[2] === "css" ? "text/css" : "text/javascript" }).end(body);
      } catch { /* fall through */ }
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}/`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// Saves the screen in viewport-high slices (the gallery screens are taller than the canvas).
async function shoot(page: Page, dir: string, name: string, variant = "neutral"): Promise<string[]> {
  const height = await page.eval<number>(`document.documentElement.scrollHeight`);
  const files: string[] = [];
  for (let y = 0, i = 1; y < height; y += HEIGHT, i++) {
    await page.eval(`window.scrollTo(0, ${y})`);
    const file = path.join(dir, `${name}${i > 1 ? `-${i}` : ""}-${variant}.png`);
    await page.screenshot(file);
    files.push(file);
  }
  await page.eval(`window.scrollTo(0, 0)`);
  return files;
}

const SMALL_TEXT = `(() => {
  const small = [];
  for (const el of document.querySelectorAll("#root *")) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const field = el.matches("input:not([type=range]):not([type=radio]), select");
    if (!own && !field) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 14) small.push((el.closest("[data-node-id]")?.dataset.nodeId ?? "?") + " " + el.tagName + " " + px + "px");
  }
  return small;
})()`;

test("gallery: every catalog type renders without overflow, small text or errors", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");

      // every catalog type renders
      const types = await page.eval<string[]>(`[...new Set([...document.querySelectorAll("[data-type]")].map((e) => e.dataset.type))]`);
      assert.deepEqual([...types].sort(), [...COMPONENT_TYPES].sort());

      // A node that clips its overflow would clip its own DRAFT tag (drawn above it).
      const clipping = await page.eval<string[]>(`[...document.querySelectorAll(".b-node")].filter((e) => getComputedStyle(e).overflow !== "visible").map((e) => e.dataset.type)`);
      assert.deepEqual(clipping, [], "nodes that clip their draft tag");

      const shots: string[] = [];
      for (const screen of SCREENS) {
        await page.eval(`window.show(${JSON.stringify(screen)})`);
        const visible = await page.eval<boolean>(`document.querySelector('[data-node-id="${screen}"]').getClientRects().length > 0`);
        assert.equal(visible, true, `${screen} is shown`);

        // no horizontal overflow
        const widths = await page.eval<{ root: number; doc: number }>(`({ root: document.getElementById("root").scrollWidth, doc: document.documentElement.scrollWidth })`);
        assert.ok(widths.root <= WIDTH && widths.doc <= WIDTH, `${screen} overflows: ${JSON.stringify(widths)}`);

        // no text below 14px
        assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], `${screen} has text below 14px`);

        shots.push(...(await shoot(page, dir, `gallery-${screen.replace(/^gallery-/, "")}`)));
      }

      // The overlays, opened (they are closed in the fixture).
      await page.eval(`window.show("gallery-a", { "a.drawer": true })`);
      assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], "drawer has text below 14px");
      shots.push(...(await shoot(page, dir, "gallery-a-drawer")));
      await page.eval(`window.show("gallery-a", { "a.modal": true })`);
      assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], "modal has text below 14px");
      shots.push(...(await shoot(page, dir, "gallery-a-modal")));

      // no page errors
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      t.diagnostic(`screenshots: ${dir} (${shots.length} files)`);
    });
  }, { width: WIDTH, height: HEIGHT });
});

const slot = (value: string) => ({ value, status: "agreed", previous: value });
const themed = (accent: string, warmth = "neutral") => ({ accent: slot(accent), warmth: slot(warmth), radius: slot("soft"), density: slot("regular") });

test("each theme sets its variables on the App element", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  const base = structuredClone(proto);
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const appVar = (name: string) => page.eval<string>(`getComputedStyle(document.querySelector('[data-node-id="${base.root.id}"]')).getPropertyValue("${name}").trim()`);
      const setTheme = (theme: unknown) => page.eval(`(() => { const p = ${JSON.stringify(theme)}; if (p) window.proto.theme = p; else delete window.proto.theme; window.draw(); })()`);

      // no theme: the house defaults
      assert.equal(await appVar("--b-accent"), "#1e293b");

      await setTheme(themed("gold"));
      assert.equal(await appVar("--b-accent"), "#c8961e");
      const ink = await appVar("--b-accent-ink");
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
      const primary = await page.eval<string>(`getComputedStyle(document.querySelector('[data-node-id="a.header.add"]')).color`);
      assert.equal(primary, rgb(ink));
      await page.eval(`window.show(${JSON.stringify(SCREENS[0])})`);
      const shots = await shoot(page, dir, `gallery-${SCREENS[0].replace(/^gallery-/, "")}`, "gold");

      // a second render of the same proto changes nothing
      const mutations = await page.eval<number>(`(() => { const o = new MutationObserver(() => {}); o.observe(document.getElementById("root"), { subtree: true, attributes: true, childList: true, characterData: true }); window.draw(); return o.takeRecords().length; })()`);
      assert.equal(mutations, 0, "idempotent render");

      await setTheme(themed("green", "warm"));
      assert.equal(await appVar("--b-accent"), "#15803d");
      assert.equal(await appVar("--b-bg"), "#faf8f3");
      shots.push(...(await shoot(page, dir, `gallery-${SCREENS[0].replace(/^gallery-/, "")}`, "green-warm")));

      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      t.diagnostic(`screenshots: ${dir} (${shots.length} files)`);
    });
  }, { width: WIDTH, height: HEIGHT });
});

test("gallery: interactions work on the new builders", async (t) => {
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const shown = (id: string) => page.eval<boolean>(`document.querySelector('[data-node-id="${id}"]').getClientRects().length > 0`);

      // Modal and Drawer open and close through on.click.
      assert.equal(await shown("a.modal"), false);
      await page.eval(`document.querySelector('[data-node-id="a.header.add"]').click()`);
      assert.equal(await shown("a.modal"), true);
      await page.eval(`document.querySelector('[data-node-id="a.modal.save"]').click()`);
      assert.equal(await shown("a.modal"), false);
      await page.eval(`document.querySelector('[data-node-id="a.row.filters"]').click()`);
      assert.equal(await shown("a.drawer"), true);

      // Tabs show only the active child.
      assert.deepEqual([await shown("a.tab1"), await shown("a.tab2")], [true, false]);

      // Toggle and Checkbox flip on click.
      await page.eval(`window.show("gallery-d")`);
      const checked = (id: string) => page.eval<string>(`document.querySelector('[data-node-id="${id}"]').getAttribute("aria-checked")`);
      assert.equal(await checked("d.toggle"), "true");
      await page.eval(`document.querySelector('[data-node-id="d.toggle"]').click()`);
      assert.equal(await checked("d.toggle"), "false");
      await page.eval(`document.querySelector('[data-node-id="d.check2"]').click()`);
      assert.equal(await checked("d.check2"), "true");

      // Typed and picked values are kept in UI state across re-renders.
      await page.eval(`(() => {
        const set = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); };
        set('[data-node-id="d.amount"] input', "42");
        set('[data-node-id="d.search"] input', "taxi");
        set('[data-node-id="d.slider"] input', "75");
        const s = document.querySelector('[data-node-id="d.category"] select'); s.value = "Travel"; s.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-node-id="d.segmented"] label:nth-child(3)').click();
        window.draw();
      })()`);
      const r = await page.eval(`({
        amount: document.querySelector('[data-node-id="d.amount"] input').value,
        search: document.querySelector('[data-node-id="d.search"] input').value,
        slider: document.querySelector('[data-node-id="d.slider"] .b-slider-value').textContent,
        category: document.querySelector('[data-node-id="d.category"] select').value,
        segment: document.querySelector('[data-node-id="d.segmented"] .is-active').textContent,
      })`);
      assert.deepEqual(r, { amount: "42", search: "taxi", slider: "75", category: "Travel", segment: "Year" });

      // A blank Table cell stays an empty cell, so the cells after it keep their columns.
      const cellsOf = await page.eval<string[][]>(`(() => {
        const find = (n) => n.id === "b.table" ? n : n.children.map(find).find(Boolean);
        find(window.proto.root).props.rows = ["@Sara K. |  | $420 | #Paid"];
        window.show("gallery-b");
        return [...document.querySelectorAll('[data-node-id="b.table"] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
      })()`);
      assert.deepEqual(cellsOf, [["SKSara K.", "", "$420", "Paid"]]);
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
    });
  }, { width: WIDTH, height: HEIGHT });
});

// ---------- the app frame: derived from the Screens, never from model output ----------

const NAV = `(() => [...document.querySelectorAll("[data-nav-screen]")].map((e) => ({
  screen: e.dataset.navScreen, text: e.textContent.trim(), active: e.classList.contains("is-active"), node: e.hasAttribute("data-node-id"),
  shown: e.getClientRects().length > 0 })))()`;
const IDEMPOTENT = `(() => { const o = new MutationObserver(() => {}); o.observe(document.getElementById("root"), { subtree: true, attributes: true, childList: true, characterData: true }); window.draw(); return o.takeRecords().length; })()`;
const screenNode = (id: string, title?: string) => ({ id, type: "Screen", props: title ? { title } : {}, status: "agreed", children: [] });
type NavItem = { screen: string; text: string; active: boolean; node: boolean; shown: boolean };

// Part 1's checks on a frame: nothing overflows sideways, no text below 14px, a second render changes nothing.
async function partOneChecks(page: Page, what: string) {
  const widths = await page.eval<{ root: number; doc: number }>(`({ root: document.getElementById("root").scrollWidth, doc: document.documentElement.scrollWidth })`);
  assert.ok(widths.root <= WIDTH && widths.doc <= WIDTH, `${what} overflows: ${JSON.stringify(widths)}`);
  assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], `${what} has text below 14px`);
  assert.equal(await page.eval<number>(IDEMPOTENT), 0, `${what}: idempotent render`);
}

test("app frame", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      const fresh = async () => {
        await page.goto(url);
        await page.waitFor("window.ready === true");
      };
      const setApp = (props: Record<string, unknown>) => page.eval(`(() => { Object.assign(window.proto.root.props, ${JSON.stringify(props)}); window.draw(); })()`);
      const titles = proto.root.children.map((s: any) => s.props.title);

      await t.test("sidebar lists every screen in order and marks the shown one", async () => {
        await fresh();
        const items = await page.eval<NavItem[]>(NAV);
        assert.deepEqual(items.map((i) => i.text), titles);
        assert.deepEqual(items.map((i) => i.screen), SCREENS);
        assert.deepEqual(items.filter((i) => i.active).map((i) => i.screen), [proto.currentScreen]);
        assert.ok(items.every((i) => !i.node && i.shown), "nav items are shown and are not prototype nodes");
        // A sidebar: a column on the left, 200px wide.
        const side = await page.eval<{ x: number; w: number }>(`(() => { const r = document.querySelector(".b-app-chrome").getBoundingClientRect(); return { x: r.left, w: r.width }; })()`);
        assert.deepEqual(side, { x: 0, w: 200 });
        await page.eval(`window.show("gallery-b")`);
        assert.deepEqual((await page.eval<NavItem[]>(NAV)).filter((i) => i.active).map((i) => i.screen), ["gallery-b"]);
        await page.eval(`window.show("gallery-a")`);
        await partOneChecks(page, "sidebar");
        await page.screenshot(path.join(dir, "frame-sidebar.png"));
      });

      await t.test("nav follows screens", async () => {
        await fresh();
        await page.eval(`(() => {
          const kids = window.proto.root.children;
          kids.push(${JSON.stringify(screenNode("gallery-f", "Reports"))});
          kids.find((s) => s.id === "gallery-b").props.title = "Numbers";
          kids.splice(kids.findIndex((s) => s.id === "gallery-c"), 1);
          window.draw();
        })()`);
        let items = await page.eval<NavItem[]>(NAV);
        assert.deepEqual(items.map((i) => [i.screen, i.text]), [
          ["gallery-a", "Frames"], ["gallery-b", "Numbers"], ["gallery-d", "Input"], ["gallery-e", "Feedback"], ["gallery-f", "Reports"],
        ]);
        await page.eval(`window.show("gallery-f")`);
        items = await page.eval<NavItem[]>(NAV);
        assert.deepEqual(items.filter((i) => i.active).map((i) => i.screen), ["gallery-f"]);
        // A screen with no title is listed by its id.
        await page.eval(`(() => { window.proto.root.children.push(${JSON.stringify(screenNode("notes"))}); window.draw(); })()`);
        assert.equal((await page.eval<NavItem[]>(NAV)).at(-1)!.text, "notes");
        assert.equal(await page.eval<number>(IDEMPOTENT), 0, "idempotent after the screen list changed");
      });

      await t.test("clicking a nav item navigates", async () => {
        await fresh();
        await page.eval(`document.querySelectorAll("[data-nav-screen]")[2].click()`);
        const shown = await page.eval<string[]>(`[...document.querySelectorAll('[data-type="Screen"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.dataset.nodeId)`);
        assert.deepEqual(shown, [SCREENS[2]]);
        assert.deepEqual((await page.eval<NavItem[]>(NAV)).filter((i) => i.active).map((i) => i.screen), [SCREENS[2]]);
        // A click on the item's label navigates too (the click lands on a child of the item).
        await page.eval(`document.querySelectorAll("[data-nav-screen]")[0].lastElementChild.click()`);
        assert.equal(await page.eval<boolean>(`document.querySelector('[data-node-id="${SCREENS[0]}"]').getClientRects().length > 0`), true);
      });

      await t.test("top nav and none", async () => {
        await fresh();
        await setApp({ nav: "top" });
        const bar = await page.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector(".b-app-chrome").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
        assert.deepEqual(bar, { x: 0, y: 0, w: WIDTH, h: 64 });
        const tops = await page.eval<number[]>(`[...document.querySelectorAll("[data-nav-screen]")].map((e) => Math.round(e.getBoundingClientRect().top))`);
        assert.equal(tops.length, SCREENS.length);
        assert.equal(new Set(tops).size, 1, `items on one line: ${tops}`);
        assert.equal(await page.eval<string>(`document.querySelector(".b-app-title").textContent`), "Ledger");
        await partOneChecks(page, "top nav");
        await page.screenshot(path.join(dir, "frame-top.png"));

        await setApp({ nav: "none" });
        assert.equal(await page.eval<number>(`document.querySelectorAll("[data-nav-screen]").length`), 0);
        assert.equal(await page.eval<boolean>(`[...document.querySelectorAll(".b-app-title, .b-app-chrome")].some((e) => e.getClientRects().length > 0)`), false, "no title");
        const screen = await page.eval<{ x: number; w: number }>(`(() => { const r = document.querySelector('[data-node-id="${SCREENS[0]}"]').getBoundingClientRect(); return { x: r.left, w: r.width }; })()`);
        assert.deepEqual(screen, { x: 0, w: WIDTH });
        await partOneChecks(page, "no frame");
      });

      await t.test("phone frame", async () => {
        await fresh();
        await setApp({ device: "phone", nav: "top" }); // nav is ignored on a phone
        const box = await page.eval<{ x: number; y: number; w: number; h: number }>(`(() => {
          const r = document.querySelector(".b-phone").getBoundingClientRect(); const o = document.getElementById("root").getBoundingClientRect();
          return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }; })()`);
        assert.deepEqual({ w: box.w, h: box.h }, { w: 380, h: 700 });
        assert.ok(Math.abs(box.x - (WIDTH - 380) / 2) <= 1 && Math.abs(box.y - (HEIGHT - 700) / 2) <= 1, `centred: ${JSON.stringify(box)}`);
        const title = () => page.eval<string>(`document.querySelector(".b-app-screentitle").textContent`);
        assert.equal(await title(), "Frames");
        await page.eval(`window.show("gallery-d")`);
        assert.equal(await title(), "Input");
        // The tabs sit at the bottom of the phone, inside it.
        const tabs = await page.eval<{ top: number; bottom: number }[]>(`[...document.querySelectorAll("[data-nav-screen]")].map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })`);
        assert.equal(tabs.length, SCREENS.length);
        assert.ok(tabs.every((r) => r.bottom <= box.y + box.h && r.top > box.y + box.h - 120), `tabs at the bottom: ${JSON.stringify(tabs)}`);
        for (const screen of SCREENS) {
          await page.eval(`window.show(${JSON.stringify(screen)})`);
          const content = await page.eval<{ scroll: number; client: number }>(`(() => { const b = document.querySelector(".b-phone .b-app-body"); return { scroll: b.scrollWidth, client: b.clientWidth }; })()`);
          assert.ok(content.scroll <= content.client, `${screen} overflows the phone: ${JSON.stringify(content)}`);
          await partOneChecks(page, `phone ${screen}`);
        }
        await page.eval(`window.show("gallery-a")`);
        await page.screenshot(path.join(dir, "frame-phone.png"));
      });

      await t.test("phone tabs cap at five", async () => {
        await fresh();
        await page.eval(`(() => {
          window.proto.root.props.device = "phone";
          window.proto.root.children.push(${JSON.stringify(screenNode("gallery-f", "Reports"))}, ${JSON.stringify(screenNode("gallery-g", "Profile"))});
          window.draw();
        })()`);
        const items = await page.eval<NavItem[]>(NAV);
        assert.deepEqual(items.map((i) => i.screen), SCREENS.slice(0, 5));
        const phone = await page.eval<{ left: number; right: number }>(`(() => { const r = document.querySelector(".b-phone").getBoundingClientRect(); return { left: r.left, right: r.right }; })()`);
        const inside = await page.eval<boolean>(`[...document.querySelectorAll("[data-nav-screen]")].every((e) => { const r = e.getBoundingClientRect(); return r.left >= ${phone.left} && r.right <= ${phone.right}; })`);
        assert.equal(inside, true, "every tab inside the phone");
        // The shown screen is past the tabs: the title bar still names it.
        await page.eval(`window.show("gallery-g")`);
        assert.equal(await page.eval<string>(`document.querySelector(".b-app-screentitle").textContent`), "Profile");
        await partOneChecks(page, "phone, seven screens");
      });

      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      t.diagnostic(`frame screenshots: ${dir}`);
    });
  }, { width: WIDTH, height: HEIGHT });
});
