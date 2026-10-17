import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialUiState, reduceInteraction } from "../public/renderer/interact.js";
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
