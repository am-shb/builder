import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore plain JS module shared with the browser
import { CATALOG, COMPONENT_TYPES, STYLE_OPTIONS, normalizeProps, parseCells, pillTone } from "../public/renderer/catalog.js";

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
