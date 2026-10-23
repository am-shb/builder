import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, componentTable } from "../src/agent/prompt-catalog.ts";
import { CATALOG, OFFERED_TYPES, STYLE_OPTIONS } from "../public/renderer/catalog.js";
import { PHONE_TABS } from "../public/renderer/interact.js";
import { ICON_NAMES } from "../public/renderer/icons.js";
import { IMAGES, IMAGE_SUBJECTS } from "../public/renderer/images.js";
import { THEME_OPTIONS } from "../public/renderer/theme.js";

test("the system prompt lists the offered components and none of the others", () => {
  const prompt = buildSystemPrompt();
  for (const type of OFFERED_TYPES) assert.ok(prompt.includes(`\`${type}\``), `missing ${type}`);
  assert.ok(prompt.includes("`ProductCard`"));
  assert.ok(!prompt.includes("`Kanban`"));
  const rows = componentTable().split("\n").filter((l) => /^\| `/.test(l));
  assert.equal(rows.length, OFFERED_TYPES.length);
});

test("the prompt offers no templates or regions", () => {
  const prompt = buildSystemPrompt();
  assert.doesNotMatch(prompt, /template/i);
  assert.doesNotMatch(prompt, /region/i);
});

test("each component's table row names its props and styles", () => {
  const rows = componentTable().split("\n");
  for (const type of OFFERED_TYPES) {
    const entry = CATALOG[type];
    const row = rows.find((r) => r.startsWith(`| \`${type}\` |`));
    assert.ok(row, `no row for ${type}`);
    const hidden = type === "Screen" ? ["template"] : [];
    for (const key of [...Object.keys(entry.props), ...entry.styles]) if (!hidden.includes(key)) assert.ok(row.includes(key), `${type} row lacks ${key}`);
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

test("the prompt has no guidance for types the model is not offered", () => {
  const prompt = buildSystemPrompt();
  assert.ok(!prompt.includes("When you fill a tab"));
  for (const type of ["Tabs", "Hero", "MediaCard", "Heading", "Banner", "Modal", "Drawer"]) assert.ok(!prompt.includes(type), type);
});

test("the prompt says the prototype block starts with the theme", () => {
  assert.ok(buildSystemPrompt().includes("`<prototype>`: the theme"));
});

test("the prompt says the frame is automatic and gives the layout rules", () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.includes("never build navigation"));
  assert.match(prompt, /children stack top to bottom in the order you add them/);
  assert.match(prompt, /`Grid` with `columns: "2"` of `ProductCard`s/);
  assert.match(prompt, /`PageHeader` as the Screen's first child/);
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

test("the prompt says the app starts with a home Screen to update", () => {
  assert.match(buildSystemPrompt(), /starts with one empty Screen, `home`: for the first page, update it \(title, icon\) instead of adding another/);
});
