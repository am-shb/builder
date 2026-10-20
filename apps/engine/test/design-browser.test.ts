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
window.drawWith = (changes) => { window.nodes = renderTree(root, proto, state, changes); };
window.show = (screen, open = {}) => { state = { ...state, screen, open }; window.draw(); window.scrollTo(0, 0); };
bindInteractions(root, () => proto, () => state, (s) => { state = s; window.draw(); });
window.draw();
// Measure in the bundled Inter (theme.css), never in a fallback still showing while it loads.
await document.fonts.load("18px Inter");
document.body.getBoundingClientRect();
await document.fonts.ready;
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
    const font = req.url?.match(/^\/renderer\/fonts\/([\w-]+\.woff2)$/);
    if (font) {
      try {
        return void res.writeHead(200, { "Content-Type": "font/woff2" }).end(readFileSync(new URL(`../public/renderer/fonts/${font[1]}`, import.meta.url)));
      } catch { /* fall through */ }
    }
    const img = req.url?.match(/^\/renderer\/images\/([a-z]+-\d+\.webp)$/);
    if (img) {
      try {
        return void res.writeHead(200, { "Content-Type": "image/webp" }).end(readFileSync(new URL(`../public/renderer/images/${img[1]}`, import.meta.url)));
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

      // The prototype is set in the bundled Inter, loaded, so text measures the same here as in the bot's Linux Chrome.
      const font = await page.eval<{ family: string; check: boolean; faces: string[] }>(`(() => ({
        family: getComputedStyle(document.querySelector(".b-app")).fontFamily,
        check: document.fonts.check("500 18px Inter"),
        faces: [...document.fonts].map((f) => f.family.replace(/["']/g, "") + " " + f.status),
      }))()`);
      assert.match(font.family, /^"?Inter"?,/, "the App's font is Inter first");
      assert.deepEqual(font.faces, ["Inter loaded"], "the bundled face is the only one, and it loaded");
      assert.equal(font.check, true, "18px Inter renders without a fallback");

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
        const want = proto.root.children.filter((s: any) => s.id !== "gallery-c").map((s: any) => [s.id, s.id === "gallery-b" ? "Numbers" : s.props.title]);
        assert.deepEqual(items.map((i) => [i.screen, i.text]), [...want, ["gallery-f", "Reports"]]);
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
        assert.equal(tabs.length, Math.min(5, SCREENS.length));
        assert.ok(tabs.every((r) => r.bottom <= box.y + box.h && r.top > box.y + box.h - 120), `tabs at the bottom: ${JSON.stringify(tabs)}`);
        for (const screen of SCREENS) {
          await page.eval(`window.show(${JSON.stringify(screen)})`);
          const content = await page.eval<{ scroll: number; client: number }>(`(() => { const b = document.querySelector(".b-phone .b-app-body"); return { scroll: b.scrollWidth, client: b.clientWidth }; })()`);
          assert.ok(content.scroll <= content.client, `${screen} overflows the phone: ${JSON.stringify(content)}`);
          // A status pill in a table cell fits inside its own background (it used to spill out of a thin column).
          const spilled = await page.eval<string[]>(`[...document.querySelectorAll(".b-phone .b-table .b-pill")].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent)`);
          assert.deepEqual(spilled, [], `${screen}: table pills spill out`);
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

// ---------- page templates: a templated Screen places its children in regions ----------

const TEMPLATE_SCREENS: { id: string; template: string }[] = proto.root.children
  .filter((s: any) => s.props.template)
  .map((s: any) => ({ id: s.id, template: s.props.template }));

// Per child of a Screen (in tree order): its id, the region it asked for, the region it sits in, and how often it is in the DOM.
const PLACED = (screen: string) => `(() => {
  const s = window.proto.root.children.find((c) => c.id === ${JSON.stringify(screen)});
  return s.children.map((c) => {
    const els = document.querySelectorAll('[data-node-id="' + c.id + '"]');
    const el = els[0];
    const region = el && el.parentElement ? el.parentElement.closest("[data-region]") : null;
    return { id: c.id, asked: c.props.region ?? null, region: region ? region.dataset.region : null, count: els.length,
      inScreen: !!el && el.closest('[data-type="Screen"]')?.dataset.nodeId === ${JSON.stringify(screen)}, parentIsScreen: !!el && el.parentElement?.dataset.nodeId === ${JSON.stringify(screen)} };
  });
})()`;
type Placed = { id: string; asked: string | null; region: string | null; count: number; inScreen: boolean; parentIsScreen: boolean };
// The regions drawn in a Screen: name, whether shown, height, and how many node elements it holds.
const REGIONS_OF = (screen: string) => `[...document.querySelector('[data-node-id="${screen}"]').querySelectorAll(":scope > [data-region]")].map((r) => ({
  name: r.dataset.region, shown: r.getClientRects().length > 0 && getComputedStyle(r).display !== "none", h: r.offsetHeight,
  nodes: [...r.children].filter((c) => c.dataset.nodeId).map((c) => c.dataset.nodeId) }))`;
type Region = { name: string; shown: boolean; h: number; nodes: string[] };

test("page templates", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  const { TEMPLATES } = await import("../public/renderer/catalog.js");
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      const fresh = async () => {
        await page.goto(url);
        await page.waitFor("window.ready === true");
      };

      await t.test("each template places children in their regions", async () => {
        await fresh();
        assert.deepEqual(TEMPLATE_SCREENS.map((s) => s.template).sort(), Object.keys(TEMPLATES).sort(), "one gallery screen per template");
        for (const { id, template } of TEMPLATE_SCREENS) {
          await page.eval(`window.show(${JSON.stringify(id)})`);
          const placed = await page.eval<Placed[]>(PLACED(id));
          for (const p of placed) {
            assert.equal(p.count, 1, `${p.id} in the DOM once`);
            assert.equal(p.region, p.asked, `${template}: ${p.id} sits in its region`);
          }
          // Regions come in the template's order.
          const names = (await page.eval<Region[]>(REGIONS_OF(id))).map((r) => r.name);
          assert.deepEqual(names, Object.keys(TEMPLATES[template].regions), `${template}: region order`);
        }
      });

      await t.test("empty regions are not drawn", async () => {
        await fresh();
        let empties = 0;
        for (const { id, template } of TEMPLATE_SCREENS) {
          await page.eval(`window.show(${JSON.stringify(id)})`);
          const asked = new Set((await page.eval<Placed[]>(PLACED(id))).map((p) => p.asked));
          for (const r of await page.eval<Region[]>(REGIONS_OF(id))) {
            if (asked.has(r.name)) {
              assert.equal(r.shown, true, `${template}.${r.name} has children and shows`);
              assert.ok(r.h > 0, `${template}.${r.name} has height`);
            } else {
              empties++;
              assert.equal(r.shown, false, `${template}.${r.name} is empty and hidden`);
              assert.equal(r.h, 0, `${template}.${r.name} takes no height`);
            }
          }
        }
        assert.ok(empties >= 2, "the gallery leaves some regions empty");
        // An empty side column collapses: the dashboard's main region takes the full width.
        await page.eval(`window.show("template-dashboard")`);
        const widths = await page.eval<{ main: number; stats: number }>(`(() => {
          const s = document.querySelector('[data-node-id="template-dashboard"]');
          return { main: s.querySelector('[data-region="main"]').offsetWidth, stats: s.querySelector('[data-region="stats"]').offsetWidth }; })()`);
        assert.equal(widths.main, widths.stats, `main spans the empty side column: ${JSON.stringify(widths)}`);
      });

      await t.test("unknown region falls back to main", async () => {
        await fresh();
        await page.eval(`(() => {
          const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
          s.children.find((c) => c.id === "td.chart").props.region = "nope";
          delete s.children.find((c) => c.id === "td.table").props.region;
          // A region on a child of a Screen with no template is ignored.
          window.proto.root.children.find((c) => c.id === "gallery-b").children[0].props.region = "side";
          window.show("template-dashboard");
        })()`);
        const placed = await page.eval<Placed[]>(PLACED("template-dashboard"));
        assert.equal(placed.find((p) => p.id === "td.chart")!.region, "main");
        assert.equal(placed.find((p) => p.id === "td.table")!.region, "main");
        await page.eval(`window.show("gallery-b")`);
        const plain = await page.eval<Placed[]>(PLACED("gallery-b"));
        assert.ok(plain.every((p) => p.count === 1 && p.parentIsScreen && p.region === null), "rendered in the Screen as before");
        assert.equal(await page.eval<number>(`document.querySelector('[data-node-id="gallery-b"]').querySelectorAll("[data-region]").length`), 0);
        assert.equal(await page.eval<boolean>(`document.querySelector('[data-node-id="${proto.root.children[1].children[0].id}"]').getClientRects().length > 0`), true);
      });

      await t.test("template change keeps every child", async () => {
        await fresh();
        await page.eval(`window.show("template-dashboard")`);
        const before = await page.eval<string[]>(`[...document.querySelectorAll('[data-node-id="template-dashboard"] [data-node-id]')].map((e) => e.dataset.nodeId).sort()`);
        const elsBefore = await page.eval<number>(`(() => { window.keep = [...document.querySelectorAll('[data-node-id="template-dashboard"] [data-node-id]')]; return window.keep.length; })()`);
        for (const template of ["feed", "chat", "landing", null, "dashboard"]) {
          // With motion (a patch's changes), as the stage renders a patch.
          await page.eval(`(() => {
            const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
            if (${JSON.stringify(template)}) s.props.template = ${JSON.stringify(template)}; else delete s.props.template;
            window.drawWith([{ kind: "updated", id: "template-dashboard" }]);
          })()`);
          const placed = await page.eval<Placed[]>(PLACED("template-dashboard"));
          for (const p of placed) {
            assert.equal(p.count, 1, `${template}: ${p.id} in the DOM once`);
            if (template) {
              const want = Object.hasOwn(TEMPLATES[template].regions, p.asked ?? "") ? p.asked : TEMPLATES[template].main;
              assert.equal(p.region, want, `${template}: ${p.id} re-placed`);
            } else {
              assert.equal(p.parentIsScreen, true, `no template: ${p.id} back in the Screen`);
            }
          }
          const after = await page.eval<string[]>(`[...document.querySelectorAll('[data-node-id="template-dashboard"] [data-node-id]')].map((e) => e.dataset.nodeId).sort()`);
          assert.deepEqual(after, before, `${template}: same nodes`);
          // Same elements (moved, not rebuilt), so motion and the spotlight find them by id.
          assert.equal(await page.eval<boolean>(`window.keep.every((e) => e.isConnected && window.nodes.get(e.dataset.nodeId) === e)`), true, `${template}: elements kept`);
          if (!template) assert.equal(await page.eval<number>(`document.querySelector('[data-node-id="template-dashboard"]').querySelectorAll("[data-region]").length`), 0);
        }
        assert.equal(elsBefore, before.length);
        assert.equal(await page.eval<number>(IDEMPOTENT), 0, "idempotent after template changes");
      });

      await t.test("reconcile order within a region", async () => {
        await fresh();
        await page.eval(`(() => {
          const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
          // Before the first main child (index 5 of the Screen, index 0 of main) and at index 0 of the Screen.
          s.children.splice(s.children.findIndex((c) => c.id === "td.chart"), 0, { id: "td.first", type: "Text", props: { region: "main", text: "First in main" }, status: "agreed", children: [] });
          s.children.unshift({ id: "td.side", type: "Text", props: { region: "side", text: "Only in side" }, status: "agreed", children: [] });
          window.show("template-dashboard");
        })()`);
        const regions = await page.eval<Region[]>(REGIONS_OF("template-dashboard"));
        const by = Object.fromEntries(regions.map((r) => [r.name, r]));
        assert.deepEqual(by.main.nodes, ["td.first", "td.chart", "td.table"]);
        assert.deepEqual(by.side.nodes, ["td.side"]);
        assert.equal(by.side.shown, true, "a region that gains a child shows");
        assert.deepEqual(by.header.nodes, ["td.header"]);
        assert.deepEqual(by.stats.nodes, ["td.spent", "td.left", "td.waiting", "td.receipts"]);
        // Moving a child within its region reorders it there.
        await page.eval(`(() => {
          const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
          const i = s.children.findIndex((c) => c.id === "td.table");
          const [table] = s.children.splice(i, 1);
          s.children.splice(s.children.findIndex((c) => c.id === "td.first"), 0, table);
          s.children = s.children.filter((c) => c.id !== "td.side");
          window.draw();
        })()`);
        const after = Object.fromEntries((await page.eval<Region[]>(REGIONS_OF("template-dashboard"))).map((r) => [r.name, r]));
        assert.deepEqual(after.main.nodes, ["td.table", "td.first", "td.chart"]);
        assert.equal(after.side.shown, false, "a region that loses its last child hides");
        assert.equal(await page.eval<number>(IDEMPOTENT), 0, "idempotent");
      });

      await t.test("a region's last child leaves with an exit, also when a template change drops its region", async () => {
        await fresh();
        const ghosts = `[...document.querySelectorAll(".m-ghost")].filter((g) => g.dataset.type === "Text" && g.getClientRects().length > 0 && getComputedStyle(g).opacity !== "0").length`;
        const side = { id: "td.side", type: "Text", props: { region: "side", text: "Only in side" }, status: "agreed", children: [] };
        const withSide = `(() => { const s = window.proto.root.children.find((c) => c.id === "template-dashboard"); s.props.template = "dashboard"; s.children.push(${JSON.stringify(side)}); window.show("template-dashboard"); })()`;
        // Removing a region's only child: the region hides on this render, the child still collapses where it was.
        await page.eval(withSide);
        const n = await page.eval<number>(`(() => {
          const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
          s.children = s.children.filter((c) => c.id !== "td.side");
          window.drawWith([{ kind: "removed", id: "td.side" }]);
          return ${ghosts};
        })()`);
        assert.equal(n, 1, "the removed child shows as an exit ghost");
        assert.equal(await page.eval<boolean>(`document.querySelector('[data-node-id="template-dashboard"] [data-region="side"]').hidden`), true);
        // A template change that drops the region (form has no side) while its child is removed.
        await fresh();
        await page.eval(withSide);
        const m = await page.eval<number>(`(() => {
          const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
          s.children = s.children.filter((c) => c.id !== "td.side");
          s.props.template = "form";
          window.drawWith([{ kind: "updated", id: "template-dashboard" }, { kind: "removed", id: "td.side" }]);
          return ${ghosts};
        })()`);
        assert.equal(m, 1, "the removed child of a dropped region shows as an exit ghost");
        // A Screen draws nothing of its own: a template change glides its children, with no cross-fade copy of the page.
        assert.equal(await page.eval<number>(`document.querySelectorAll('.m-ghost[data-type="Screen"]').length`), 0);
        await page.waitFor(`document.querySelectorAll(".m-ghost").length === 0`, 3000);
        assert.equal(await page.eval<number>(`document.querySelectorAll('[data-node-id="td.side"]').length`), 0);
      });

      await t.test("narrow content areas (comparison previews) do not overflow", async () => {
        await fresh();
        // Content area = canvas - 200px sidebar: 540..700px.
        for (const width of [740, 780, 820, 840, 860, 900]) {
          await page.eval(`document.getElementById("root").style.width = "${width}px"`);
          for (const { id, template } of TEMPLATE_SCREENS) {
            await page.eval(`window.show(${JSON.stringify(id)})`);
            const over = await page.eval<{ root: number; regions: string[] }>(`({
              root: document.getElementById("root").scrollWidth,
              regions: [...document.querySelectorAll('[data-node-id="${id}"] > [data-region]')].flatMap((r) => {
                // Anything drawn past its region's right edge (into the next column or off the canvas).
                const edge = r.getBoundingClientRect().right + 1;
                return [...r.querySelectorAll("*")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > edge)
                  .map((e) => r.dataset.region + " " + (e.closest("[data-node-id]")?.dataset.nodeId ?? "?") + "." + e.className + " " + Math.round(e.getBoundingClientRect().right - edge) + "px");
              }) })`);
            assert.ok(over.root <= width, `${template} at ${width}: root ${over.root}`);
            assert.deepEqual(over.regions, [], `${template} at ${width}: regions overflow`);
            const body = await page.eval<number>(`document.querySelector(".b-app-body").clientWidth`);
            const cols = await page.eval<number>(`new Set([...document.querySelectorAll('[data-node-id="${id}"] > [data-region]')].filter((r) => r.getClientRects().length).map((r) => r.offsetLeft)).size`);
            if (body < 640) assert.equal(cols, 1, `${template} at ${width} (content ${body}px): one column`);
          }
          if (width === 780) {
            await page.eval(`window.show("template-feed")`);
            await page.screenshot(path.join(dir, "template-feed-narrow.png"));
          }
        }
        await page.eval(`document.getElementById("root").style.width = ""`);
      });

      await t.test("every template passes the part 1 checks and is screenshotted", async () => {
        await fresh();
        for (const { id, template } of TEMPLATE_SCREENS) {
          await page.eval(`window.show(${JSON.stringify(id)})`);
          await partOneChecks(page, `template ${template}`);
          const height = await page.eval<number>(`document.documentElement.scrollHeight`);
          for (let y = 0, i = 1; y < height; y += HEIGHT, i++) {
            await page.eval(`window.scrollTo(0, ${y})`);
            await page.screenshot(path.join(dir, `template-${template}${i > 1 ? `-${i}` : ""}.png`));
          }
          await page.eval(`window.scrollTo(0, 0)`);
        }
      });

      await t.test("on a phone every template is one column in region order", async () => {
        await fresh();
        await page.eval(`(() => { window.proto.root.props.device = "phone"; window.draw(); })()`);
        for (const { id, template } of TEMPLATE_SCREENS) {
          await page.eval(`window.show(${JSON.stringify(id)})`);
          const shown = (await page.eval<(Region & { x: number; y: number; w: number })[]>(`[...document.querySelector('[data-node-id="${id}"]').querySelectorAll(":scope > [data-region]")]
            .filter((r) => r.getClientRects().length > 0).map((r) => ({ name: r.dataset.region, x: r.offsetLeft, y: r.offsetTop, w: r.offsetWidth }))`));
          assert.ok(shown.length > 0);
          assert.equal(new Set(shown.map((r) => r.x)).size, 1, `${template}: one column ${JSON.stringify(shown)}`);
          assert.equal(new Set(shown.map((r) => r.w)).size, 1, `${template}: same width`);
          const ys = shown.map((r) => r.y);
          assert.deepEqual(ys, [...ys].sort((a, b) => a - b), `${template}: region order`);
          assert.deepEqual(shown.map((r) => r.name), Object.keys(TEMPLATES[template].regions).filter((n) => shown.some((r) => r.name === n)));
          const content = await page.eval<{ scroll: number; client: number }>(`(() => { const b = document.querySelector(".b-phone .b-app-body"); return { scroll: b.scrollWidth, client: b.clientWidth }; })()`);
          assert.ok(content.scroll <= content.client, `${template} overflows the phone: ${JSON.stringify(content)}`);
          await partOneChecks(page, `phone template ${template}`);
          if (template === "dashboard") await page.screenshot(path.join(dir, "template-dashboard-phone.png"));
        }
      });

      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      t.diagnostic(`template screenshots: ${dir}`);
    });
  }, { width: WIDTH, height: HEIGHT });
});

// ---------- icons: inline Lucide svgs from the curated set ----------

test("icons", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const count = (sel: string) => page.eval<number>(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
      const svgIn = (id: string, part = "") => count(`[data-node-id="${id}"] ${part} svg`.replace("  ", " "));

      await t.test("builders draw their icon as an inline svg", async () => {
        await page.eval(`window.show("gallery-b")`);
        assert.equal(await svgIn("b.stat1", ".b-stat-icon"), 1, "StatCard");
        assert.equal(await svgIn("b.list.1", ".b-listitem-icon"), 0, "an unknown name draws none");
        await page.eval(`window.show("gallery-d")`);
        assert.equal(await svgIn("d.amount", ".b-field-icon"), 1, "Input");
        assert.equal(await svgIn("d.btn.primary", ".b-button-icon"), 1, "Button");
        await page.eval(`window.show("gallery-e")`);
        assert.equal(await svgIn("e.empty", ".b-empty-art"), 1, "EmptyState");
        await page.eval(`window.show("gallery-c")`);
        assert.equal(await svgIn("c.features", ".b-feature-icon"), 2, "FeatureGrid draws icons for rows with three cells");
        assert.equal(await count(".b-app-navicon svg"), SCREENS.length, "nav");
      });

      await t.test("svg shape and sizes", async () => {
        await page.eval(`window.show("gallery-b")`);
        const svg = await page.eval<Record<string, string | number>>(`(() => {
          const s = document.querySelector('[data-node-id="b.stat1"] .b-stat-icon svg');
          return { ns: s.namespaceURI, viewBox: s.getAttribute("viewBox"), stroke: s.getAttribute("stroke"), w: s.getAttribute("width"),
            hidden: s.getAttribute("aria-hidden"), kids: s.children.length, color: getComputedStyle(s).color, box: s.getBoundingClientRect().width };
        })()`);
        assert.equal(svg.ns, "http://www.w3.org/2000/svg");
        assert.equal(svg.viewBox, "0 0 24 24");
        assert.equal(svg.stroke, "currentColor");
        assert.equal(svg.w, "24");
        assert.equal(svg.box, 24);
        assert.equal(svg.hidden, "true");
        assert.ok((svg.kids as number) > 0);
        await page.eval(`window.show("gallery-d")`);
        assert.equal(await page.eval<number>(`document.querySelector('[data-node-id="d.btn.primary"] svg').getBoundingClientRect().width`), 20);
        assert.equal(await page.eval<number>(`document.querySelector(".b-app-navicon svg").getBoundingClientRect().width`), 24);
      });

      await t.test("unknown names render nothing and throw nothing; aliases and case resolve", async () => {
        await page.eval(`(() => {
          const find = (n, id) => n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean);
          const f = (id) => find(window.proto.root, id);
          f("d.btn.primary").props.icon = "Nope";
          f("d.amount").props.icon = "MONEY";
          window.show("gallery-d");
        })()`);
        assert.equal(await svgIn("d.btn.primary", ".b-button-icon"), 0);
        assert.equal(await svgIn("d.amount", ".b-field-icon"), 1, "alias, upper case");
        assert.equal(await page.eval<boolean>(`document.querySelector('[data-node-id="d.btn.primary"] .b-button-icon').hidden`), true);
        assert.equal(await page.eval<string>(`document.querySelector('[data-node-id="d.btn.primary"]').textContent.trim()`), "Submit");
        assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      });

      await t.test("re-rendering is idempotent, and an icon change swaps only that svg", async () => {
        await page.eval(`window.show("gallery-b")`);
        assert.equal(await page.eval<number>(IDEMPOTENT), 0);
        const before = await page.eval<string>(`document.querySelector('[data-node-id="b.stat1"] svg path').getAttribute("d")`);
        await page.eval(`(() => {
          const find = (n, id) => n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean);
          find(window.proto.root, "b.stat1").props.icon = "trending-up"; window.draw();
        })()`);
        const after = await page.eval<string>(`document.querySelector('[data-node-id="b.stat1"] svg path').getAttribute("d")`);
        assert.notEqual(after, before);
        assert.equal(await page.eval<number>(IDEMPOTENT), 0);
      });

      await t.test("nav and phone tabs draw screen icons; screenshots", async () => {
        await page.eval(`window.show("gallery-b")`);
        await shoot(page, dir, "icons-stats");
        await page.screenshot(path.join(dir, "icons-sidebar.png"));
        await page.eval(`(() => { Object.assign(window.proto.root.props, { device: "phone" }); window.draw(); })()`);
        assert.equal(await count(".b-phone .b-app-navicon svg") > 0, true, "phone tabs");
        await page.screenshot(path.join(dir, "icons-phone.png"));
        await page.eval(`window.show("gallery-c")`);
        await page.eval(`(() => { delete window.proto.root.props.device; window.draw(); })()`);
        await shoot(page, dir, "icons-content");
        t.diagnostic(`screenshots: ${dir}`);
      });
    });
  }, { width: WIDTH, height: HEIGHT });
});

// ---------- images: built-in photos, chosen deterministically ----------

test("image resolution", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const loaded = `(async () => {
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
        return [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src);
      })()`;
      const src = (id: string) => page.eval<string | null>(`document.querySelector('[data-node-id="${id}"] img')?.getAttribute("src") ?? null`);
      const block = (id: string) => page.eval<string | null>(`document.querySelector('[data-node-id="${id}"] .b-img-block')?.textContent ?? null`);
      const setImage = (id: string, image: string) => page.eval(`(() => {
        const find = (n) => n.id === ${JSON.stringify(id)} ? n : n.children.map(find).find(Boolean);
        find(window.proto.root).props.image = ${JSON.stringify(image)};
      })()`);

      await t.test("a specific name, a subject, an unknown word", async () => {
        await page.eval(`window.show("gallery-c")`);
        assert.match((await src("c.img1"))!, /food-3\.webp$/);
        assert.equal(await page.eval(`document.querySelector('[data-node-id="c.img1"] img').alt`), "Pouring latte art");
        const food = await page.eval<string>(`(window.show("gallery-c"), document.querySelector('[data-node-id="c.img2"] img').getAttribute("src"))`);
        assert.match(food, /\/renderer\/images\/places-\d\.webp$/);
        await setImage("c.img1", "food");
        await page.eval(`window.show("gallery-c")`);
        const first = (await src("c.img1"))!;
        assert.match(first, /\/food-\d\.webp$/);
        await page.eval(`window.show("gallery-c")`);
        assert.equal(await src("c.img1"), first, "same on re-render");
        await setImage("c.img1", "pizza");
        await page.eval(`window.show("gallery-c")`);
        assert.equal(await src("c.img1"), null);
        assert.equal((await block("c.img1"))?.toLowerCase(), "pizza");
        await setImage("c.img1", "food-3");
        await page.eval(`window.show("gallery-c")`);
        assert.match((await src("c.img1"))!, /food-3\.webp$/, "back to a photo");
        await setImage("c.img1", "food-99");
        await page.eval(`window.show("gallery-c")`);
        assert.equal(await src("c.img1"), null, "a specific image that does not exist");
        await setImage("c.img1", "food-3");
      });

      await t.test("the same subject gives the same photo on a second page load", async () => {
        const pick = async () => {
          await page.goto(url);
          await page.waitFor("window.ready === true");
          await page.eval(`window.show("gallery-c")`);
          return src("c.product1");
        };
        const a = await pick();
        assert.match(a!, /products-\d\.webp$/);
        assert.equal(await pick(), a);
      });

      await t.test("photos fill their boxes and all load", async () => {
        const shots: string[] = [];
        for (const screen of SCREENS) {
          await page.eval(`window.show(${JSON.stringify(screen)})`);
          assert.deepEqual(await page.eval<string[]>(loaded), [], `${screen} has broken images`);
          const bad = await page.eval<string[]>(`[...document.querySelectorAll("#root img")].filter((i) => {
            const cs = getComputedStyle(i); const r = i.getBoundingClientRect(); const p = i.parentElement.getBoundingClientRect();
            return cs.objectFit !== "cover" || i.loading !== "eager" || i.draggable || r.width < p.width - 1 || r.height < p.height - 1;
          }).map((i) => i.getAttribute("src"))`);
          assert.deepEqual(bad, [], `${screen} images not covering their box`);
        }
        await page.eval(`window.show("gallery-c")`);
        shots.push(...(await shoot(page, dir, "gallery-c-photos")));
        t.diagnostic(`screenshots: ${dir} (${shots.length} files)`);
      });

      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
    });
  }, { width: WIDTH, height: HEIGHT });
});

// Fixes from the final review of parts 2 and 3.
const textNode = (id: string, text: string) => ({ id, type: "Text", props: { text }, status: "agreed", children: [] });
const tallDraftScreen = (id: string) => ({
  id, type: "Screen", props: { title: "Long" }, status: "draft",
  children: [
    ...Array.from({ length: 40 }, (_, i) => textNode(`${id}.t${i}`, `Line ${i}`)),
    { id: `${id}.modal`, type: "Modal", props: { title: "Sure?", open: false }, status: "draft", children: [textNode(`${id}.modal.t`, "Body")] },
    { id: `${id}.drawer`, type: "Drawer", props: { title: "Filters", open: false }, status: "draft", children: [textNode(`${id}.drawer.t`, "Body")] },
  ],
});

test("review fixes", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      const fresh = async () => {
        await page.goto(url);
        await page.waitFor("window.ready === true");
      };
      type Box = { x: number; y: number; w: number; h: number };
      const rect = (sel: string) => page.eval<Box>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);

      for (const kind of ["modal", "drawer"]) {
        await t.test(`phone ${kind} on a scrolled tall draft Screen stays inside the phone`, async () => {
          await fresh();
          await page.eval(`(() => { window.proto.root.props.device = "phone"; window.proto.root.children.push(${JSON.stringify(tallDraftScreen("tall"))}); window.show("tall"); })()`);
          await page.eval(`document.querySelector(".b-phone .b-app-body").scrollTop = 400`);
          await page.eval(`window.show("tall", { "tall.${kind}": true })`);
          const phone = await rect(".b-phone");
          const bar = await rect(".b-phone .b-app-screentitle");
          const box = await rect(`[data-node-id="tall.${kind}"] .b-${kind}-box`);
          const inner = { x: phone.x + 10, y: phone.y + 10, w: phone.w - 20, h: phone.h - 20 };
          const overlay = await rect(`[data-node-id="tall.${kind}"]`);
          assert.ok(overlay.y >= inner.y - 0.5 && overlay.y + overlay.h <= inner.y + inner.h + 0.5, `${kind} overlay covers the phone, not the screen: ${JSON.stringify({ overlay, phone })}`);
          assert.ok(box.x >= inner.x - 0.5 && box.x + box.w <= inner.x + inner.w + 0.5, `${kind} box inside the phone: ${JSON.stringify({ box, phone })}`);
          assert.ok((kind === "drawer" || box.y >= bar.y + bar.h - 0.5) && box.y + box.h <= inner.y + inner.h + 0.5, `${kind} box below the title bar, inside the phone: ${JSON.stringify({ box, bar, phone })}`);
          if (kind === "modal") await page.screenshot(path.join(dir, "phone-modal-open.png"));
        });
      }

      await t.test("desktop overlays on a draft Screen still cover the app", async () => {
        await fresh();
        await page.eval(`(() => { window.proto.root.children.push(${JSON.stringify(tallDraftScreen("tall"))}); window.show("tall", { "tall.modal": true }); })()`);
        const app = await rect('[data-node-id="app"]');
        const overlay = await rect('[data-node-id="tall.modal"]');
        assert.deepEqual([overlay.x, overlay.w], [app.x, app.w], "covers the app's width");
        assert.ok(overlay.y >= app.y - 0.5 && overlay.y + overlay.h <= app.y + app.h + 0.5, `inside the app: ${JSON.stringify({ overlay, app })}`);
      });

      await t.test("the sidebar shows a two-word app name and a long screen title in full", async () => {
        await fresh();
        await page.eval(`(() => {
          window.proto.root.props.title = "Expense Tracker";
          window.proto.root.children.find((s) => s.id === "gallery-b").props.title = "Team budget planning";
          window.draw();
        })()`);
        const clipped = await page.eval<string[]>(`[...document.querySelectorAll(".b-app-title, .b-app-navlabel")].filter((e) => e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent)`);
        assert.deepEqual(clipped, [], "nothing is clipped");
        const title = await page.eval<{ h: number; lh: number; fs: number }>(`(() => { const e = document.querySelector(".b-app-title"); const c = getComputedStyle(e); return { h: e.getBoundingClientRect().height, lh: parseFloat(c.lineHeight), fs: parseFloat(c.fontSize) }; })()`);
        assert.ok(title.fs >= 14, "title at least 14px");
        assert.ok(title.h <= title.lh * 2 + 1, `title takes at most two lines: ${JSON.stringify(title)}`);
        await page.eval(`window.draw()`);
        await page.screenshot(path.join(dir, "sidebar-two-word-name.png"));
        // The top bar keeps one line.
        await page.eval(`(() => { window.proto.root.props.nav = "top"; window.draw(); })()`);
        const lines = await page.eval<number[]>(`[...document.querySelectorAll(".b-app-title, .b-app-navlabel")].map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)))`);
        assert.ok(lines.every((n) => n <= 1), `top bar stays single line: ${lines}`);
      });

      await t.test("opening another screen on a phone starts at the top", async () => {
        await fresh();
        await page.eval(`(() => { window.proto.root.props.device = "phone"; window.proto.root.children.push(${JSON.stringify(tallDraftScreen("tall"))}, ${JSON.stringify(tallDraftScreen("tall2"))}); window.show("tall"); })()`);
        await page.eval(`document.querySelector(".b-phone .b-app-body").scrollTop = 300`);
        await page.eval(`window.draw()`);
        assert.equal(await page.eval<number>(`document.querySelector(".b-phone .b-app-body").scrollTop`), 300, "a redraw of the same screen keeps the scroll");
        await page.eval(`window.show("tall2")`);
        assert.equal(await page.eval<number>(`document.querySelector(".b-phone .b-app-body").scrollTop`), 0);
      });

      await t.test("a lone stat card keeps its quarter of the row", async () => {
        await fresh();
        await page.eval(`window.show("template-dashboard")`);
        const sel = '[data-node-id="template-dashboard"] [data-region="stats"]';
        const before = await page.eval<{ count: number; region: number; first: number }>(`(() => { const r = document.querySelector('${sel}'); return { count: r.children.length, region: r.getBoundingClientRect().width, first: r.children[0].getBoundingClientRect().width }; })()`);
        await page.eval(`(() => {
          const s = window.proto.root.children.find((c) => c.id === "template-dashboard");
          const stats = s.children.filter((c) => c.props.region === "stats");
          for (const c of stats.slice(1)) s.children.splice(s.children.indexOf(c), 1);
          window.draw();
        })()`);
        const after = await page.eval<{ count: number; region: number; first: number }>(`(() => { const r = document.querySelector('${sel}'); return { count: r.children.length, region: r.getBoundingClientRect().width, first: r.children[0].getBoundingClientRect().width }; })()`);
        assert.equal(after.count, 1);
        assert.ok(Math.abs(after.first - after.region / 4) < after.region * 0.05, `one card is about a quarter of the row: ${JSON.stringify({ before, after })}`);
        await page.screenshot(path.join(dir, "dashboard-one-stat.png"));
      });

      t.diagnostic(`screenshots: ${dir}`);
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
    });
  }, { width: WIDTH, height: HEIGHT });
});
