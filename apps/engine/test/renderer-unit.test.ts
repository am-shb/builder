import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialUiState, reduceInteraction, frameNav } from "../public/renderer/interact.js";
import type { Prototype } from "../src/ui/schema.ts";

const proto: Prototype = JSON.parse(readFileSync(new URL("./fixtures/proto-todo.json", import.meta.url), "utf8"));

test("reduceInteraction navigate/toggle/open/close/append/setValue", () => {
  const s0 = initialUiState(proto);
  assert.deepEqual(s0, { screen: "home", toggles: {}, open: {}, lists: {}, values: {} });

  const nav = reduceInteraction(s0, { kind: "navigate", screen: "settings" }, proto);
  assert.equal(nav.screen, "settings");
  assert.equal(s0.screen, "home", "input state is not mutated");

  const t1 = reduceInteraction(s0, { kind: "toggle", target: "dark" }, proto);
  assert.equal(t1.toggles.dark, true);
  assert.equal(reduceInteraction(t1, { kind: "toggle", target: "dark" }, proto).toggles.dark, false);

  const o = reduceInteraction(s0, { kind: "open", target: "dlg" }, proto);
  assert.equal(o.open.dlg, true);
  assert.equal(reduceInteraction(o, { kind: "close", target: "dlg" }, proto).open.dlg, false);

  const v = reduceInteraction(s0, { kind: "setValue", target: "home.input", value: "milk" }, proto);
  assert.equal(v.values["home.input"], "milk");
});

test("toggle on an initially-on node turns it off", () => {
  const p: Prototype = {
    currentScreen: "home",
    root: { id: "app", type: "App", props: {}, status: "agreed", children: [
      { id: "home", type: "Screen", props: {}, status: "agreed", children: [
        { id: "sw", type: "Toggle", props: { on: true }, status: "agreed", children: [] },
        { id: "cb", type: "Checkbox", props: { checked: true }, status: "agreed", children: [] },
        { id: "off", type: "Toggle", props: {}, status: "agreed", children: [] },
      ] },
    ] },
  };
  let s = initialUiState(p);
  s = reduceInteraction(s, { kind: "toggle", target: "sw" }, p);
  s = reduceInteraction(s, { kind: "toggle", target: "cb" }, p);
  s = reduceInteraction(s, { kind: "toggle", target: "off" }, p);
  assert.deepEqual([s.toggles.sw, s.toggles.cb, s.toggles.off], [false, false, true]);
  s = reduceInteraction(s, { kind: "toggle", target: "sw" }, p);
  assert.equal(s.toggles.sw, true);
});

test("append moves the input value into the list and clears the input", () => {
  let s = initialUiState(proto);
  s = reduceInteraction(s, { kind: "setValue", target: "home.input", value: "  buy milk " }, proto);
  s = reduceInteraction(s, { kind: "append", list: "home.list", fromInput: "home.input" }, proto);
  assert.deepEqual(s.lists["home.list"], ["buy milk"]);
  assert.equal(s.values["home.input"], "");

  // empty input is a no-op
  const again = reduceInteraction(s, { kind: "append", list: "home.list", fromInput: "home.input" }, proto);
  assert.deepEqual(again.lists["home.list"], ["buy milk"]);

  s = reduceInteraction(s, { kind: "setValue", target: "home.input", value: "walk dog" }, proto);
  s = reduceInteraction(s, { kind: "append", list: "home.list", fromInput: "home.input" }, proto);
  assert.deepEqual(s.lists["home.list"], ["buy milk", "walk dog"]);
});

test("frameNav: one item per Screen in tree order, titled, at most five on a phone", () => {
  const screen = (id: string, props: Record<string, unknown> = {}) => ({ id, type: "Screen", props, status: "agreed", children: [] });
  const app = (props: Record<string, unknown>, n = 3) => ({
    id: "app", type: "App", props, status: "agreed",
    children: [screen("home", { title: "Home", icon: "home" }), screen("team"), ...Array.from({ length: n - 2 }, (_, i) => screen(`s${i}`, { title: `S${i}` }))],
  });
  assert.deepEqual(frameNav(app({})), { kind: "sidebar", items: [
    { screen: "home", title: "Home", icon: "home" }, { screen: "team", title: "team", icon: "" }, { screen: "s0", title: "S0", icon: "" },
  ] });
  assert.equal(frameNav(app({ nav: "top" })).kind, "top");
  assert.equal(frameNav(app({ nav: "bottom" })).kind, "sidebar", "an unknown nav is the default");
  assert.deepEqual(frameNav(app({ nav: "none" })), { kind: "none", items: [] });
  const phone = frameNav(app({ device: "phone", nav: "none" }, 7)); // nav is ignored on a phone
  assert.equal(phone.kind, "phone");
  assert.deepEqual(phone.items.map((i) => i.screen), ["home", "team", "s0", "s1", "s2"]);
  // Only Screens are listed; a blank title falls back to the id.
  const mixed = { ...app({}), children: [screen("a", { title: "  " }), { id: "x", type: "Text", props: {}, status: "agreed", children: [] }] };
  assert.deepEqual(frameNav(mixed).items, [{ screen: "a", title: "a", icon: "" }]);
});
