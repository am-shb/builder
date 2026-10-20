import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyPrototype, applyBatch, findNode, fromToolBatch, themeStatusOp, withAgreedTheme } from "../src/ui/tree.ts";
import { Prototype, patchBatchJsonSchema, ToolPatchBatch } from "../src/ui/schema.ts";
import type { UiNode, PatchOp } from "../src/ui/schema.ts";

const leaf = (id: string, type: UiNode["type"] = "Text", children: UiNode[] = []): UiNode =>
  ({ id, type, props: {}, status: "draft", children });
const batch = (ops: PatchOp[]) => ({ label: "test", ops });

test("add/update/move/remove produce changes and a new tree", () => {
  const p0 = emptyPrototype("Team To-Do");
  const r = applyBatch(p0, { label: "Added: task input", by: "Amir", ops: [
    { op: "add", parentId: "home", node: { id: "home.add", type: "Input", props: { placeholder: "Add a task" }, status: "draft", children: [] } },
  ] });
  assert.ok(r.ok);
  assert.deepEqual(r.changes, [{ kind: "added", id: "home.add", label: "Added: task input", by: "Amir" }]);
  assert.equal(findNode(p0, "home.add"), undefined, "input not mutated");
  assert.ok(findNode(r.proto, "home.add"));

  const r2 = applyBatch(r.proto, batch([
    { op: "update", id: "home.add", props: { placeholder: "New task" }, status: "agreed", decisionId: "d1" },
    { op: "add", parentId: "app", node: leaf("two", "Screen") },
    { op: "move", id: "home.add", parentId: "two", index: 0 },
    { op: "set_screen", screenId: "two" },
    { op: "remove", id: "home.add" },
  ]));
  assert.ok(r2.ok);
  assert.deepEqual(r2.changes.map((c) => c.kind), ["updated", "added", "moved", "screen", "removed"]);
  assert.equal(r2.proto.currentScreen, "two");
  assert.equal(findNode(r2.proto, "home.add"), undefined);
  assert.ok(findNode(r.proto, "home.add"), "input not mutated");
});

test("update merges props and sets status/decisionId", () => {
  const r = applyBatch(emptyPrototype("X"), batch([
    { op: "add", parentId: "home", node: { ...leaf("t"), props: { text: "a", size: 2 } } },
    { op: "update", id: "t", props: { size: 3 }, status: "agreed", decisionId: "d9" },
  ]));
  assert.ok(r.ok);
  const n = findNode(r.proto, "t")!;
  assert.deepEqual(n.props, { text: "a", size: 3 });
  assert.equal(n.status, "agreed");
  assert.equal(n.decisionId, "d9");
});

test("batch referencing removed node is rejected atomically", () => {
  const p0 = emptyPrototype("X");
  const r1 = applyBatch(p0, batch([{ op: "add", parentId: "home", node: leaf("home.add") }]));
  assert.ok(r1.ok);
  const before = structuredClone(r1.proto);
  const r = applyBatch(r1.proto, batch([
    { op: "remove", id: "home.add" },
    { op: "update", id: "home.add", props: { a: "b" } },
  ]));
  assert.equal(r.ok, false);
  assert.deepEqual(r1.proto, before);
});

test("rejects duplicate ids, Screen outside App, unknown type, depth > 12, > 400 nodes", () => {
  const p = emptyPrototype("X");
  const bad = (ops: PatchOp[]) => assert.equal(applyBatch(p, batch(ops)).ok, false);

  bad([{ op: "add", parentId: "home", node: leaf("home") }]);
  bad([{ op: "add", parentId: "home", node: leaf("a", "Screen") }]);
  bad([{ op: "add", parentId: "home", node: { ...leaf("a"), type: "Bogus" as never } }]);
  bad([{ op: "add", parentId: "nope", node: leaf("a") }]);
  bad([{ op: "add", parentId: "home", node: leaf("A_B") }]);
  bad([{ op: "add", parentId: "home", node: leaf("a"), index: 5 }]);
  bad([{ op: "remove", id: "app" }]);
  bad([{ op: "remove", id: "missing" }]);
  bad([{ op: "move", id: "home", parentId: "home", index: 0 }]);

  // depth: app(1) > home(2) > d0..d9 (10 more) = 12 levels is fine; 13 is not
  let deep = leaf("d9", "Section");
  for (let i = 8; i >= 0; i--) deep = leaf(`d${i}`, "Section", [deep]);
  assert.ok(applyBatch(p, batch([{ op: "add", parentId: "home", node: deep }])).ok);
  bad([{ op: "add", parentId: "home", node: leaf("top", "Section", [deep]) }]);

  // node count: app + home = 2; wrapper + 397 leaves = 400 total is fine, one more is not
  const kids = (n: number) => Array.from({ length: n }, (_, i) => leaf(`n${i}`));
  assert.ok(applyBatch(p, batch([{ op: "add", parentId: "home", node: leaf("w", "Section", kids(397)) }])).ok);
  bad([{ op: "add", parentId: "home", node: leaf("w", "Section", kids(398)) }]);
});

test("set_screen requires an existing Screen id", () => {
  const p = emptyPrototype("X");
  assert.equal(applyBatch(p, batch([{ op: "set_screen", screenId: "app" }])).ok, false);
  assert.equal(applyBatch(p, batch([{ op: "set_screen", screenId: "ghost" }])).ok, false);
  assert.ok(applyBatch(p, batch([{ op: "set_screen", screenId: "home" }])).ok);
});

test("label over 60 chars is rejected", () => {
  const r = applyBatch(emptyPrototype("X"), { label: "x".repeat(61), ops: [] });
  assert.equal(r.ok, false);
});

test("fixture is a valid prototype", () => {
  const proto = JSON.parse(readFileSync(new URL("./fixtures/proto-todo.json", import.meta.url), "utf8"));
  assert.ok(Prototype.safeParse(proto).success);
  assert.ok(applyBatch(proto, batch([{ op: "update", id: "home.add", status: "agreed" }])).ok);
});

test("patchBatchJsonSchema is strict (additionalProperties false at every object, no $ref)", () => {
  const schema = patchBatchJsonSchema();
  assert.ok(!JSON.stringify(schema).includes('"$ref"'), "no $ref");
  let objects = 0;
  const walk = (s: unknown, path: string) => {
    if (Array.isArray(s)) return s.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, unknown>;
    if (o.type === "object" || o.properties) {
      objects++;
      assert.equal(o.additionalProperties, false, `${path} must set additionalProperties:false`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  walk(schema, "$");
  assert.ok(objects > 8, "walked the object schemas");
});

test("fromToolBatch converts props pairs to a record and the result applies via applyBatch", () => {
  const { batch } = fromToolBatch({ label: "Added: form", by: "Amir", ops: [
    { op: "add", parentId: "app", node: { id: "form", type: "Screen", props: [{ key: "title", value: "Form" }] } },
    { op: "add", parentId: "form", node: { id: "form.size", type: "Select", props: [{ key: "label", value: "Size" }, { key: "options", value: ["S", "M"] }] } },
    { op: "update", id: "form.size", props: [{ key: "value", value: "M" }] },
  ] });
  const add = batch.ops[1]!;
  assert.ok(add.op === "add");
  assert.deepEqual(add.node.props, { label: "Size", options: ["S", "M"] });
  assert.deepEqual(add.node.children, []);
  const r = applyBatch(emptyPrototype("X"), batch);
  assert.ok(r.ok);
  assert.deepEqual(findNode(r.proto, "form.size")!.props, { label: "Size", options: ["S", "M"], value: "M" });
});

test("fromToolBatch drops __proto__/constructor/prototype keys", () => {
  const { batch, dropped } = fromToolBatch({ label: "x", ops: [
    { op: "add", parentId: "home", node: { id: "t", type: "Text", props: [
      { key: "__proto__", value: "x" }, { key: "constructor", value: "x" }, { key: "prototype", value: "x" }, { key: "text", value: "ok" },
    ] } },
  ] });
  const add = batch.ops[0]!;
  assert.ok(add.op === "add");
  assert.deepEqual(Object.keys(add.node.props), ["text"]);
  assert.equal(dropped, 3);
  assert.equal(Object.getPrototypeOf(add.node.props), Object.prototype);
});

describe("trimmed tool format", () => {
  test("fromToolBatch fills status and the batch decisionId", () => {
    const { batch } = fromToolBatch({ label: "x", decisionId: "d7", ops: [
      { op: "add", parentId: "home", node: { id: "a", type: "Text", props: [{ key: "text", value: "A" }] } },
      { op: "add", parentId: "home", node: { id: "b", type: "Text", props: [], decisionId: "d8" } },
      { op: "update", id: "a", props: [{ key: "text", value: "A2" }] },
      { op: "set_theme", accent: "gold" },
    ] });
    const [a, b, upd, theme] = batch.ops;
    assert.ok(a.op === "add" && b.op === "add");
    assert.deepEqual([a.node.status, a.node.decisionId], ["draft", "d7"]);
    assert.deepEqual([b.node.status, b.node.decisionId], ["draft", "d8"], "a node's own decisionId wins");
    assert.deepEqual(upd, { op: "update", id: "a", props: { text: "A2" }, decisionId: "d7" });
    assert.deepEqual(theme, { op: "set_theme", values: { accent: "gold" }, decisionId: "d7" });
    assert.equal("decisionId" in batch, false, "the internal batch has no batch-level decisionId");
  });

  test("fromToolBatch uses the default decisionId when the batch has none", () => {
    const { batch } = fromToolBatch({ label: "x", ops: [
      { op: "add", parentId: "home", node: { id: "a", type: "Text", props: [] } },
    ] }, { decisionId: "d-c1" });
    const [a] = batch.ops;
    assert.ok(a.op === "add");
    assert.equal(a.node.decisionId, "d-c1");
    const bare = fromToolBatch({ label: "x", ops: [{ op: "add", parentId: "home", node: { id: "a", type: "Text", props: [] } }] }).batch.ops[0];
    assert.ok(bare.op === "add");
    assert.equal("decisionId" in bare.node, false);
  });

  test("fromToolBatch drops bad props and counts them", () => {
    const { batch, dropped } = fromToolBatch({ label: "x", ops: [
      { op: "add", parentId: "home", node: { id: "b", type: "Button", props: [
        { key: "label", value: "Go" }, { key: "variant", value: "neon" }, { key: "color", value: "#f00" }, { key: "size", value: "lg" },
      ] } },
      { op: "add", parentId: "home", node: { id: "c", type: "ChartCard", props: [{ key: "data", value: [1, 2, 3] }, { key: "kind", value: "pie" }] } },
      { op: "update", id: "b", props: [{ key: "label", value: true }, { key: "icon", value: "wallet" }] },
      { op: "update", id: "nope", props: [{ key: "label", value: "x" }] },
    ] });
    const [b, c, upd, missing] = batch.ops;
    assert.ok(b.op === "add" && c.op === "add");
    assert.deepEqual(b.node.props, { label: "Go", size: "lg" });
    assert.deepEqual(c.node.props, { data: [1, 2, 3] });
    assert.deepEqual(upd, { op: "update", id: "b", props: { icon: "wallet" } }, "an update is checked against the type it names in the batch");
    assert.deepEqual(missing, { op: "update", id: "nope", props: {} }, "a node of unknown type takes no props; the op still fails to apply");
    assert.equal(dropped, 5);
  });

  test("an update is checked against the current prototype's node type", () => {
    const proto = emptyPrototype("X");
    proto.root.children[0].children.push({ id: "t", type: "Toggle", props: { label: "On" }, status: "draft", children: [] });
    const { batch, dropped } = fromToolBatch({ label: "x", ops: [
      { op: "update", id: "t", props: [{ key: "on", value: true }, { key: "rows", value: ["a"] }] },
    ] }, {}, proto);
    assert.deepEqual(batch.ops[0], { op: "update", id: "t", props: { on: true } });
    assert.equal(dropped, 1);
  });

  test("an update whose props all drop is skipped unless it names its own decision", () => {
    const { batch, dropped } = fromToolBatch({ label: "x", decisionId: "d9", ops: [
      { op: "add", parentId: "home", node: { id: "b", type: "Button", props: [{ key: "label", value: "Go" }] } },
      { op: "update", id: "b", props: [{ key: "color", value: "#f00" }, { key: "px", value: 4 }] },
      { op: "update", id: "b", props: [{ key: "color", value: "#f00" }], decisionId: "d3" },
    ] });
    assert.deepEqual(batch.ops.slice(1), [{ op: "update", id: "b", props: {}, decisionId: "d3" }], "only the op with its own decisionId stays");
    assert.equal(dropped, 3);
  });

  test("a set_theme with no slots is skipped and counted, not a batch rejection", () => {
    const { batch, dropped } = fromToolBatch({ label: "x", ops: [
      { op: "set_theme" },
      { op: "add", parentId: "home", node: { id: "t", type: "Text", props: [{ key: "text", value: "hi" }] } },
    ] });
    assert.equal(dropped, 1);
    assert.deepEqual(batch.ops.map((o) => o.op), ["add"]);
    assert.ok(applyBatch(emptyPrototype("X"), batch).ok);
  });

  test("an update with props: [] and no decisionId of its own is skipped like the all-dropped case", () => {
    const proto = emptyPrototype("X");
    proto.root.children[0].children.push({ id: "t", type: "Text", props: { text: "hi" }, status: "agreed", decisionId: "d1", children: [] });
    const { batch } = fromToolBatch({ label: "x", decisionId: "d9", ops: [
      { op: "update", id: "t", props: [] },
      { op: "update", id: "t", props: [], decisionId: "d3" },
    ] }, {}, proto);
    assert.deepEqual(batch.ops, [{ op: "update", id: "t", props: {}, decisionId: "d3" }]);
  });

  test("a set_theme with no decision id at all is dropped and counted", () => {
    const { batch, dropped } = fromToolBatch({ label: "x", ops: [
      { op: "set_theme", accent: "gold" },
      { op: "add", parentId: "home", node: { id: "t", type: "Text", props: [{ key: "text", value: "hi" }] } },
    ] });
    assert.equal(dropped, 1);
    assert.deepEqual(batch.ops.map((o) => o.op), ["add"]);
    assert.deepEqual(fromToolBatch({ label: "x", ops: [{ op: "set_theme", accent: "gold" }] }, { decisionId: "d1" }).batch.ops,
      [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }], "a default id is enough");
  });

  test("drop_theme becomes a theme_status revert", () => {
    const { batch } = fromToolBatch({ label: "x", decisionId: "d2", ops: [{ op: "drop_theme", decisionId: "d1" }] });
    assert.deepEqual(batch.ops, [{ op: "theme_status", decisionId: "d1", to: "revert" }]);
  });

  test("the tool schema has no status field", () => {
    assert.equal(JSON.stringify(patchBatchJsonSchema()).includes('"status"'), false);
  });

  test("an unknown component type is rejected", () => {
    const parsed = ToolPatchBatch.safeParse({ label: "x", ops: [{ op: "add", parentId: "home", node: { id: "s", type: "Stack", props: [] } }] });
    assert.equal(parsed.success, false);
    assert.ok(ToolPatchBatch.safeParse({ label: "x", ops: [{ op: "add", parentId: "home", node: { id: "s", type: "Section", props: [] } }] }).success);
  });

  test("a tool node with status is rejected", () => {
    const parsed = ToolPatchBatch.safeParse({ label: "x", ops: [{ op: "add", parentId: "home", node: { id: "s", type: "Text", props: [], status: "agreed" } }] });
    assert.equal(parsed.success, false);
  });
});

describe("theme", () => {
  const apply = (p: Prototype, ops: PatchOp[]) => {
    const r = applyBatch(p, batch(ops));
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r;
  };
  const base = () => emptyPrototype("X");

  test("set_theme makes a draft and remembers the agreed value", () => {
    const r = apply(base(), [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]);
    assert.deepEqual(r.proto.theme!.accent, { value: "gold", status: "draft", decisionId: "d1", previous: "slate" });
    assert.deepEqual(r.proto.theme!.radius, { value: "soft", status: "agreed", previous: "soft" });
    assert.deepEqual(r.changes, [{ kind: "theme", id: "app", label: "test" }]);
  });

  test("set_theme rejects an unknown value", () => {
    const r = applyBatch(base(), batch([{ op: "set_theme", values: { accent: "neon" } } as PatchOp]));
    assert.equal(r.ok, false);
  });

  test("set_theme rejects empty values", () => {
    assert.equal(applyBatch(base(), batch([{ op: "set_theme", values: {} }])).ok, false);
  });

  test("theme_status agreed then a second proposal keeps the agreed one as previous", () => {
    let p = apply(base(), [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "agreed" }]).proto;
    assert.deepEqual(p.theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
    p = apply(p, [{ op: "set_theme", values: { accent: "green" }, decisionId: "d2" }]).proto;
    assert.deepEqual(p.theme!.accent, { value: "green", status: "draft", decisionId: "d2", previous: "gold" });
  });

  test("theme revert after an agreed theme returns to that agreed value", () => {
    let p = apply(base(), [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "agreed" }]).proto;
    p = apply(p, [{ op: "set_theme", values: { accent: "green" }, decisionId: "d2" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d2", to: "revert" }]).proto;
    assert.deepEqual(p.theme!.accent, { value: "gold", status: "agreed", previous: "gold", reverted: { value: "green", decisionId: "d2" } });
    assert.equal("decisionId" in p.theme!.accent, false);
  });

  test("theme_status only touches slots carrying that decisionId", () => {
    let p = apply(base(), [{ op: "set_theme", values: { radius: "round" }, decisionId: "d3" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d3", to: "agreed" }]).proto;
    p = apply(p, [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d4" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d4", to: "revert" }]).proto;
    assert.deepEqual(p.theme!.radius, { value: "round", status: "agreed", decisionId: "d3", previous: "soft" });
    assert.deepEqual(p.theme!.accent, { value: "slate", status: "agreed", previous: "slate", reverted: { value: "gold", decisionId: "d4" } });
  });

  test("agreeing keeps previous so reverting an agreed decision restores the theme before it", () => {
    let p = apply(base(), [{ op: "set_theme", values: { accent: "blue" }, decisionId: "d0" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d0", to: "agreed" }]).proto;
    p = apply(p, [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "agreed" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "revert" }]).proto;
    assert.deepEqual(p.theme!.accent, { value: "blue", status: "agreed", previous: "blue", reverted: { value: "gold", decisionId: "d1" } });
  });

  test("a theme_status that matches nothing is valid and records no change", () => {
    const r = apply(base(), [{ op: "theme_status", decisionId: "nope", to: "revert" }]);
    assert.deepEqual(r.changes, []);
  });

  test("themeStatusOp returns null when nothing carries the decision", () => {
    const p0 = base();
    assert.equal(themeStatusOp(p0, "d1", "revert"), null);
    let p = apply(p0, [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]).proto;
    assert.deepEqual(themeStatusOp(p, "d1", "revert"), { op: "theme_status", decisionId: "d1", to: "revert" });
    assert.deepEqual(themeStatusOp(p, "d1", "agreed"), { op: "theme_status", decisionId: "d1", to: "agreed" });
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "agreed" }]).proto;
    p.theme!.accent.decisionId = "d1";
    assert.equal(themeStatusOp(p, "d1", "agreed"), null);
  });

  test("a revert remembers the rejected proposal, and agreeing that decision later re-applies it", () => {
    let p = apply(base(), [{ op: "set_theme", values: { accent: "gold", radius: "round" }, decisionId: "d1" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "revert" }]).proto;
    assert.deepEqual(p.theme!.accent, { value: "slate", status: "agreed", previous: "slate", reverted: { value: "gold", decisionId: "d1" } });
    assert.ok(Prototype.safeParse(p).success, "a remembered proposal is a valid prototype");
    assert.deepEqual(themeStatusOp(p, "d1", "agreed"), { op: "theme_status", decisionId: "d1", to: "agreed" });
    assert.equal(themeStatusOp(p, "d1", "revert"), null, "nothing left to revert");
    const r = apply(p, [{ op: "theme_status", decisionId: "d1", to: "agreed" }]);
    assert.deepEqual(r.proto.theme!.accent, { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" });
    assert.deepEqual(r.proto.theme!.radius, { value: "round", status: "agreed", decisionId: "d1", previous: "soft" });
    assert.deepEqual(r.changes, [{ kind: "theme", id: "app", label: "test" }]);
    assert.equal(themeStatusOp(r.proto, "d1", "agreed"), null);
  });

  test("a later set_theme on the slot forgets the reverted proposal", () => {
    let p = apply(base(), [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]).proto;
    p = apply(p, [{ op: "theme_status", decisionId: "d1", to: "revert" }]).proto;
    p = apply(p, [{ op: "set_theme", values: { accent: "green" }, decisionId: "d2" }]).proto;
    assert.deepEqual(p.theme!.accent, { value: "green", status: "draft", decisionId: "d2", previous: "slate" });
    assert.equal(themeStatusOp(p, "d1", "agreed"), null);
    assert.deepEqual(apply(p, [{ op: "theme_status", decisionId: "d1", to: "agreed" }]).changes, []);
  });

  test("a remembered proposal with an unknown value is not a valid prototype", () => {
    const p = base();
    p.theme = {
      accent: { value: "slate", status: "agreed", previous: "slate", reverted: { value: "neon", decisionId: "d1" } },
      warmth: { value: "neutral", status: "agreed", previous: "neutral" },
      radius: { value: "soft", status: "agreed", previous: "soft" },
      density: { value: "regular", status: "agreed", previous: "regular" },
    };
    assert.equal(Prototype.safeParse(p).success, false);
  });

  test("withAgreedTheme shows previous for draft slots", () => {
    const p = apply(base(), [{ op: "set_theme", values: { accent: "gold" }, decisionId: "d1" }]).proto;
    const before = structuredClone(p);
    const shown = withAgreedTheme(p);
    assert.equal(shown.theme!.accent.value, "slate");
    assert.equal(shown.theme!.accent.status, "agreed");
    assert.deepEqual(p, before);
  });
});

test("the new expense fixture applies cleanly", () => {
  const batches = JSON.parse(readFileSync(new URL("./fixtures/expense-batches.new.json", import.meta.url), "utf8")) as unknown[];
  assert.ok(batches.length > 0);
  let proto = emptyPrototype("Ledger");
  for (const raw of batches) {
    const parsed = ToolPatchBatch.parse(raw);
    const { batch: converted, dropped } = fromToolBatch(parsed, {}, proto);
    assert.equal(dropped, 0, `no dropped props in "${parsed.label}"`);
    const r = applyBatch(proto, converted);
    assert.ok(r.ok, `batch "${parsed.label}" applies`);
    proto = r.proto;
  }
  assert.ok(findNode(proto, "home.recent"));
  assert.equal(findNode(proto, "home")?.props.template, "dashboard");
  assert.equal(findNode(proto, "home.stat-spent")?.props.region, "stats");
});
