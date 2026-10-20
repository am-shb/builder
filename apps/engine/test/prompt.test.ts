import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, componentTable } from "../src/agent/prompt-catalog.ts";
import { CATALOG, COMPONENT_TYPES, STYLE_OPTIONS, TEMPLATES } from "../public/renderer/catalog.js";
import { PHONE_TABS } from "../public/renderer/interact.js";
import { ICON_NAMES } from "../public/renderer/icons.js";
import { IMAGES, IMAGE_SUBJECTS } from "../public/renderer/images.js";
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

test("the prompt lists every icon name and warns against inventing one", () => {
  const prompt = buildSystemPrompt();
  for (const name of ICON_NAMES) assert.ok(prompt.includes(name), name);
  assert.match(prompt, /Never invent one/);
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

test("the prompt leaves bringing back a reverted theme to the system", () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.includes("the system puts the theme back to its last agreed look by itself"));
  assert.ok(!/send `set_theme` again/.test(prompt), "no rule to re-send a reverted theme");
});

test("the prompt says to make a filled tab the active one", () => {
  assert.ok(buildSystemPrompt().includes("When you fill a tab, set the `Tabs` `active` to it in the same batch"));
});

test("the prompt says the prototype block starts with the theme", () => {
  assert.ok(buildSystemPrompt().includes("`<prototype>`: the theme"));
});

test("the prompt lists every template with its regions and says the frame is automatic", () => {
  const prompt = buildSystemPrompt();
  for (const [name, t] of Object.entries(TEMPLATES)) {
    const row = prompt.split("\n").find((l) => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, `no row for template ${name}`);
    for (const region of Object.keys(t.regions)) assert.ok(row.includes(region), `${name} row lacks ${region}`);
    assert.ok(row.includes(t.suggest), `${name} row lacks suggest`);
  }
  assert.ok(prompt.includes("never build navigation"));
});

test("every component-like word in a template's suggest line is a real type", () => {
  for (const [name, t] of Object.entries(TEMPLATES)) {
    for (const word of t.suggest.match(/\b[A-Z][A-Za-z]+\b/g) ?? []) assert.ok(COMPONENT_TYPES.includes(word), `${name} suggests unknown type ${word}`);
  }
});

test("the prompt states the phone tab limit from the renderer", () => {
  assert.ok(buildSystemPrompt().includes(`first ${PHONE_TABS} Screens as bottom tabs`));
  assert.ok(buildSystemPrompt().includes("sidebar on a desktop screen"));
});

test("the prompt lists every image subject, name and caption, and says when to use which", () => {
  const prompt = buildSystemPrompt();
  for (const subject of IMAGE_SUBJECTS) assert.ok(prompt.includes(`${subject}:`), subject);
  for (const img of IMAGES) assert.ok(prompt.includes(`${img.file.replace(/\.webp$/, "")} ${img.caption.toLowerCase()}`), img.file);
  assert.match(prompt, /subject name/);
  assert.match(prompt, /placeholder/);
});

test("the prompt says the app starts with a home Screen to update, and where region applies", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /starts with one empty Screen, `home`: for the first page, update it \(title, icon, template\) instead of adding another/);
  assert.match(prompt, /`region` only matters on direct children of a templated Screen/);
});
