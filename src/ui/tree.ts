import { MAX_DEPTH, MAX_NODES, PatchBatch, Prototype } from "./schema.ts";
import type { Change, UiNode } from "./schema.ts";

export type ApplyResult =
  | { ok: true; proto: Prototype; changes: Change[] }
  | { ok: false; error: string };

export function emptyPrototype(appName: string): Prototype {
  return {
    currentScreen: "home",
    root: {
      id: "app", type: "App", props: { title: appName }, status: "draft",
      children: [{ id: "home", type: "Screen", props: { title: "Home" }, status: "draft", children: [] }],
    },
  };
}

export function findNode(proto: Prototype, id: string): UiNode | undefined {
  return findIn(proto.root, id);
}

function findIn(node: UiNode, id: string): UiNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findIn(c, id);
    if (hit) return hit;
  }
  return undefined;
}

function findParent(node: UiNode, id: string): UiNode | undefined {
  for (const c of node.children) {
    if (c.id === id) return node;
    const hit = findParent(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Whole-tree invariants, checked once after all ops. Returns an error message or null. */
function validateTree(proto: Prototype): string | null {
  if (proto.root.type !== "App") return "root must be an App";
  const seen = new Set<string>();
  let count = 0;
  let error: string | null = null;
  const walk = (n: UiNode, depth: number, parent: UiNode | null) => {
    if (error) return;
    if (++count > MAX_NODES) return void (error = `more than ${MAX_NODES} nodes`);
    if (depth > MAX_DEPTH) return void (error = `depth exceeds ${MAX_DEPTH} at "${n.id}"`);
    if (seen.has(n.id)) return void (error = `duplicate id "${n.id}"`);
    seen.add(n.id);
    if (n.type === "App" && parent) return void (error = `App "${n.id}" must be the root`);
    if (n.type === "Screen" && parent?.type !== "App") return void (error = `Screen "${n.id}" must be a direct child of App`);
    for (const c of n.children) walk(c, depth + 1, n);
  };
  walk(proto.root, 1, null);
  if (error) return error;
  const screen = findNode(proto, proto.currentScreen);
  if (screen?.type !== "Screen") return `current screen "${proto.currentScreen}" is not a Screen`;
  return null;
}

/** Pure and atomic: clones the input, applies ops in order, and returns the first error with no partial result. */
export function applyBatch(input: Prototype, batchInput: PatchBatch): ApplyResult {
  const parsed = PatchBatch.safeParse(batchInput);
  if (!parsed.success) return { ok: false, error: `invalid batch: ${parsed.error.message}` };
  const batch = parsed.data;

  const proto = structuredClone(input);
  const changes: Change[] = [];
  const note = (kind: Change["kind"], id: string) => {
    const c: Change = { kind, id, label: batch.label };
    if (batch.by !== undefined) c.by = batch.by;
    changes.push(c);
  };

  for (const [i, op] of batch.ops.entries()) {
    const fail = (msg: string): ApplyResult => ({ ok: false, error: `op ${i} (${op.op}): ${msg}` });
    switch (op.op) {
      case "add": {
        const parent = findNode(proto, op.parentId);
        if (!parent) return fail(`parent "${op.parentId}" not found`);
        const index = op.index ?? parent.children.length;
        if (index > parent.children.length) return fail(`index ${index} out of range`);
        parent.children.splice(index, 0, op.node);
        note("added", op.node.id);
        break;
      }
      case "update": {
        const node = findNode(proto, op.id);
        if (!node) return fail(`node "${op.id}" not found`);
        if (op.props) Object.assign(node.props, op.props);
        if (op.status) node.status = op.status;
        if (op.decisionId !== undefined) node.decisionId = op.decisionId;
        note("updated", op.id);
        break;
      }
      case "remove": {
        if (op.id === proto.root.id) return fail("cannot remove the root");
        const parent = findParent(proto.root, op.id);
        if (!parent) return fail(`node "${op.id}" not found`);
        parent.children = parent.children.filter((c) => c.id !== op.id);
        note("removed", op.id);
        break;
      }
      case "move": {
        if (op.id === proto.root.id) return fail("cannot move the root");
        const node = findNode(proto, op.id);
        const oldParent = findParent(proto.root, op.id);
        const newParent = findNode(proto, op.parentId);
        if (!node || !oldParent) return fail(`node "${op.id}" not found`);
        if (!newParent) return fail(`parent "${op.parentId}" not found`);
        if (findIn(node, op.parentId)) return fail("cannot move a node into itself");
        oldParent.children = oldParent.children.filter((c) => c.id !== op.id);
        if (op.index > newParent.children.length) return fail(`index ${op.index} out of range`);
        newParent.children.splice(op.index, 0, node);
        note("moved", op.id);
        break;
      }
      case "set_screen": {
        if (findNode(proto, op.screenId)?.type !== "Screen") return fail(`"${op.screenId}" is not a Screen`);
        proto.currentScreen = op.screenId;
        note("screen", op.screenId);
        break;
      }
    }
  }

  const error = validateTree(proto);
  if (error) return { ok: false, error };
  return { ok: true, proto, changes };
}
