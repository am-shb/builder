import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, componentTable } from "../src/agent/prompt-catalog.ts";
import { CATALOG, COMPONENT_TYPES, STYLE_OPTIONS } from "../public/renderer/catalog.js";
import { THEME_OPTIONS } from "../public/renderer/theme.js";

test("the system prompt lists every component", () => {
  const prompt = buildSystemPrompt();
  for (const type of COMPONENT_TYPES) assert.ok(prompt.includes(`\`${type}\``), `missing ${type}`);
});

test("each component's table row names its props and styles", () => {
  const rows = componentTable().split("\n");
  for (const [type, entry] of Object.entries(CATALOG)) {
    const row = rows.find((r) => r.startsWith(`| \`${type}\` |`));
    assert.ok(row, `no row for ${type}`);
    for (const key of [...Object.keys(entry.props), ...entry.styles]) assert.ok(row.includes(key), `${type} row lacks ${key}`);
  }
  for (const [key, values] of Object.entries(STYLE_OPTIONS)) assert.ok(componentTable().includes(`${key}: ${values.join("|")}`), key);
});

test("the prompt names every theme value", () => {
  const prompt = buildSystemPrompt();
  for (const [slot, values] of Object.entries(THEME_OPTIONS)) assert.ok(prompt.includes(`${slot}: ${values.join("|")}`), slot);
});

test("the prompt has no leftover placeholder", () => {
  assert.doesNotMatch(buildSystemPrompt(), /\{\{|\}\}/);
});

test("the prompt never mentions status on nodes", () => {
  const prompt = buildSystemPrompt();
  assert.doesNotMatch(prompt, /status: "draft"/);
  assert.doesNotMatch(prompt, /\(props, status/);
  assert.doesNotMatch(prompt, /ImagePlaceholder|ChartPlaceholder|NavBar|`Stack`/);
});
