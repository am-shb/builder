import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore plain JS module shared with the browser
import { CATALOG, COMPONENT_TYPES, STYLE_OPTIONS, normalizeProps, parseCells, pillTone, TEMPLATES, templateRegion } from "../public/renderer/catalog.js";

const GROUPS = ["frames", "data", "content", "input", "feedback", "conversation"];
const KINDS = ["s", "n", "b", "ss", "ns"];

test("every catalog entry is well formed", () => {
  assert.ok(COMPONENT_TYPES.length >= 45);
  assert.deepEqual(COMPONENT_TYPES, Object.keys(CATALOG));
  assert.equal(COMPONENT_TYPES[0], "App");
  for (const [type, e] of Object.entries(CATALOG) as [string, any][]) {
    assert.ok(GROUPS.includes(e.group), `${type} group`);
    for (const [k, kind] of Object.entries(e.props) as [string, any][]) {
      const ok = KINDS.includes(kind) || (Array.isArray(kind) && kind.length > 0 && kind.every((v: unknown) => typeof v === "string"));
      assert.ok(ok, `${type}.${k} kind`);
    }
    for (const s of e.styles) assert.ok(s in STYLE_OPTIONS, `${type} style ${s}`);
    assert.equal(typeof e.children, "boolean");
    assert.ok(e.note.length > 0, `${type} note`);
  }
  assert.equal(CATALOG.App.children, true);
  assert.equal(CATALOG.Screen.children, true);
});

test("normalizeProps keeps valid props and style options", () => {
  const input = { label: "Spent", value: "$12,480", trend: "up", tone: "accent", span: "2" };
  const r = normalizeProps("StatCard", input);
  assert.deepEqual(r.props, input);
  assert.deepEqual(r.dropped, []);
});

test("normalizeProps drops unknown keys, wrong kinds and enum misses", () => {
  const r = normalizeProps("StatCard", { label: "x", colour: "red", trend: "sideways", tone: "neon", size: 3 });
  assert.deepEqual(r.props, { label: "x" });
  assert.deepEqual([...r.dropped].sort(), ["colour", "size", "tone", "trend"]);
});

test("normalizeProps coerces numbers and numeric strings", () => {
  assert.equal(normalizeProps("Progress", { value: "40" }).props.value, 40);
  assert.equal(normalizeProps("StatCard", { value: 12 }).props.value, "12");
  assert.deepEqual(normalizeProps("ChartCard", { data: ["4", 5, "x"] }).props.data, [4, 5]);
});

test("normalizeProps on __proto__ and constructor keys drops them", () => {
  const input = JSON.parse('{"__proto__":{"x":1},"constructor":"y","label":"ok"}');
  const r = normalizeProps("StatCard", input);
  assert.deepEqual(r.props, { label: "ok" });
  assert.deepEqual([...r.dropped].sort(), ["__proto__", "constructor"]);
  assert.equal(Object.getPrototypeOf(r.props), Object.prototype);
  assert.deepEqual(normalizeProps("Nope", { a: 1 }), { props: {}, dropped: ["a"] });
});

test("parseCells", () => {
  assert.deepEqual(parseCells("@Sara K. | Figma seats | $420 | #Approved"), [
    { kind: "person", text: "Sara K." },
    { kind: "text", text: "Figma seats" },
    { kind: "text", text: "$420" },
    { kind: "pill", text: "Approved", tone: "success" },
  ]);
  assert.deepEqual(parseCells(""), []);
  assert.deepEqual(parseCells("a||b"), [{ kind: "text", text: "a" }, { kind: "text", text: "b" }]);
});

test("parseCells keeps empty cells when asked, so table columns stay in place", () => {
  assert.deepEqual(parseCells("a| |#Paid", { keepEmpty: true }), [
    { kind: "text", text: "a" }, { kind: "text", text: "" }, { kind: "pill", text: "Paid", tone: "success" },
  ]);
  assert.deepEqual(parseCells("a| |b", { keepEmpty: false }), [{ kind: "text", text: "a" }, { kind: "text", text: "b" }]);
});

test("pillTone", () => {
  assert.equal(pillTone("Pending"), "warning");
  assert.equal(pillTone("OVERDUE"), "danger");
  assert.equal(pillTone("Paid"), "success");
  assert.equal(pillTone("Blue"), "default");
});

const TABLE: Record<string, { regions: Record<string, string>; main: string; areas: string; columns: string }> = {
  dashboard: { regions: { header: "row", stats: "grid", main: "stack", side: "stack" }, main: "main", areas: '"header header" "stats stats" "main side"', columns: "2fr 1fr" },
  "list-detail": { regions: { header: "row", list: "stack", detail: "stack" }, main: "detail", areas: '"header header" "list detail"', columns: "1fr 1.6fr" },
  form: { regions: { header: "row", main: "stack", aside: "stack" }, main: "main", areas: '"header header" "main aside"', columns: "2fr 1fr" },
  feed: { regions: { header: "row", main: "stack", side: "stack" }, main: "main", areas: '"header header" "main side"', columns: "2fr 1fr" },
  landing: { regions: { hero: "stack", features: "stack", pricing: "grid", footer: "row" }, main: "features", areas: '"hero" "features" "pricing" "footer"', columns: "1fr" },
  chat: { regions: { list: "stack", main: "stack" }, main: "main", areas: '"list main"', columns: "1fr 2fr" },
  checkout: { regions: { header: "row", main: "stack", summary: "stack" }, main: "main", areas: '"header header" "main summary"', columns: "1.6fr 1fr" },
};

test("TEMPLATES holds the seven templates exactly", () => {
  assert.deepEqual(Object.keys(TEMPLATES).sort(), Object.keys(TABLE).sort());
  for (const [name, want] of Object.entries(TABLE)) {
    const t = (TEMPLATES as any)[name];
    assert.deepEqual(Object.fromEntries(Object.entries(t.regions).map(([k, v]: [string, any]) => [k, v.layout])), want.regions, name);
    for (const r of Object.values(t.regions) as any[]) assert.ok(r.note.length > 0);
    assert.equal(t.main, want.main);
    assert.equal(t.areas, want.areas);
    assert.equal(t.columns, want.columns);
    assert.ok(t.suggest.length > 0);
    const named = t.areas.match(/[a-z]+/g) as string[];
    for (const n of named) assert.ok(n in t.regions, `${name} area ${n}`);
  }
  assert.deepEqual(CATALOG.Screen.props.template, Object.keys(TABLE));
});

test("region is accepted on every type except App and Screen", () => {
  assert.deepEqual(normalizeProps("StatCard", { region: "stats" }).props, { region: "stats" });
  assert.deepEqual(normalizeProps("Screen", { region: "x" }), { props: {}, dropped: ["region"] });
  assert.deepEqual(normalizeProps("App", { region: "x" }), { props: {}, dropped: ["region"] });
});

test("App nav and device, Screen template and icon", () => {
  assert.deepEqual(normalizeProps("App", { nav: "sidebar", device: "phone" }).props, { nav: "sidebar", device: "phone" });
  assert.deepEqual(normalizeProps("App", { nav: "bottom" }), { props: {}, dropped: ["nav"] });
  assert.deepEqual(normalizeProps("Screen", { template: "feed", icon: "home" }).props, { template: "feed", icon: "home" });
});

test("templateRegion", () => {
  assert.equal(templateRegion("dashboard", "stats"), "stats");
  assert.equal(templateRegion("dashboard", "nope"), "main");
  assert.equal(templateRegion("dashboard", undefined), "main");
  assert.equal(templateRegion("landing", "zzz"), "features");
  assert.equal(templateRegion(undefined, "stats"), null);
  assert.equal(templateRegion("bogus", "stats"), null);
});
