import { MAX_DEPTH, MAX_NODES, PatchBatch, Prototype } from "./schema.ts";
import type { Change, PatchOp, Theme, ThemeSlotName, ToolPatchBatch, ToolProp, UiNode } from "./schema.ts";
import { DEFAULT_THEME_VALUES, THEME_SLOTS } from "../../public/renderer/theme.js";
import { normalizeProps } from "../../public/renderer/catalog.js";

export type ApplyResult =
  | { ok: true; proto: Prototype; changes: Change[] }
  | { ok: false; error: string };

// The app's title until the room names it.
export const UNTITLED_APP = "Untitled app";

export function emptyPrototype(appName: string): Prototype {
  return {
    currentScreen: "home",
    root: {
      id: "app", type: "App", props: { title: appName }, status: "draft",
      children: [{ id: "home", type: "Screen", props: { title: "Home" }, status: "draft", children: [] }],
    },
  };
}

function defaultTheme(): Theme {
  const theme = {} as Theme;
  for (const slot of THEME_SLOTS as ThemeSlotName[]) {
    const value = DEFAULT_THEME_VALUES[slot];
    theme[slot] = { value, status: "agreed", previous: value };
  }
  return theme;
}

/**
 * The op that agrees or reverts every theme slot carrying `decisionId`; null when it would change
 * nothing. Agreeing also covers slots that remember `decisionId` as their reverted proposal.
 */
export function themeStatusOp(proto: Prototype, decisionId: string, to: "agreed" | "revert"): PatchOp | null {
  const slots = Object.values(proto.theme ?? {});
  const carrying = slots.filter((s) => s.decisionId === decisionId);
  const changes = to === "agreed"
    ? carrying.some((s) => s.status === "draft") || slots.some((s) => s.reverted?.decisionId === decisionId)
    : carrying.length > 0;
  return changes ? { op: "theme_status", decisionId, to } : null;
}

/** The prototype with draft theme slots shown at their last agreed value. Does not mutate the input. */
export function withAgreedTheme(proto: Prototype): Prototype {
  if (!proto.theme) return proto;
  const out = structuredClone(proto);
  for (const slot of Object.values(out.theme!)) {
    if (slot.status === "draft") {
      slot.value = slot.previous;
      slot.status = "agreed";
      delete slot.decisionId;
    }
  }
  return out;
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

export function findParent(node: UiNode, id: string): UiNode | undefined {
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
      case "set_theme": {
        const theme = proto.theme ?? defaultTheme();
        for (const slot of THEME_SLOTS as ThemeSlotName[]) {
          const value = op.values[slot];
          if (value === undefined) continue;
          const cur = theme[slot];
          cur.previous = cur.status === "agreed" ? cur.value : cur.previous;
          cur.value = value;
          cur.status = "draft";
          if (op.decisionId !== undefined) cur.decisionId = op.decisionId;
          else delete cur.decisionId;
          delete cur.reverted;
        }
        proto.theme = theme;
        note("theme", proto.root.id);
        break;
      }
      case "theme_status": {
        // A revert remembers the proposal it took off, so agreeing that decision later puts it back.
        let changed = false;
        for (const slot of Object.values(proto.theme ?? {})) {
          if (op.to === "agreed" && slot.reverted?.decisionId === op.decisionId) {
            slot.previous = slot.value;
            slot.value = slot.reverted.value;
            slot.status = "agreed";
            slot.decisionId = op.decisionId;
            delete slot.reverted;
          } else if (slot.decisionId !== op.decisionId) {
            continue;
          } else if (op.to === "agreed") {
            if (slot.status !== "draft") continue;
            slot.status = "agreed";
          } else {
            slot.reverted = { value: slot.value, decisionId: op.decisionId };
            slot.value = slot.previous;
            slot.status = "agreed";
            delete slot.decisionId;
          }
          changed = true;
        }
        if (changed) note("theme", proto.root.id);
        break;
      }
    }
  }

  const error = validateTree(proto);
  if (error) return { ok: false, error };
  return { ok: true, proto, changes };
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function propsToRecord(props: ToolProp[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of props) if (!UNSAFE_KEYS.has(key)) out[key] = value;
  return out;
}

/**
 * Pure conversion from the model-facing batch to the internal PatchBatch. Props become a record,
 * checked against the catalog: unknown keys, wrong kinds and values outside an enum are dropped
 * and counted in `dropped` (unsafe keys too). An update is checked against the type of the node it
 * names: added earlier in this batch, else in `proto`; a node of unknown type takes no props.
 * Added nodes are drafts. Adds, updates and set_theme take the op's or node's own decisionId, else
 * the batch's, else `defaults.decisionId`. drop_theme becomes a theme_status revert. An update whose
 * props were all dropped or empty (on a known node, naming no decisionId of its own) is skipped, as is
 * a set_theme that sets no slot or has no decision at all, which could never be agreed or dropped
 * (both counted in `dropped`).
 */
export function fromToolBatch(
  t: ToolPatchBatch, defaults: { decisionId?: string } = {}, proto?: Prototype,
): { batch: PatchBatch; dropped: number } {
  const batchDecision = t.decisionId ?? defaults.decisionId;
  const withDecision = (own: string | undefined) => {
    const id = own ?? batchDecision;
    return id === undefined ? {} : { decisionId: id };
  };
  const added = new Map<string, string>();
  let dropped = 0;
  const normalize = (type: string | undefined, props: ToolProp[]): UiNode["props"] => {
    const record = propsToRecord(props);
    dropped += props.length - Object.keys(record).length;
    const out = normalizeProps(type ?? "", record);
    dropped += out.dropped.length;
    return out.props;
  };
  const ops = t.ops.flatMap((op): PatchOp[] => {
    switch (op.op) {
      case "add": {
        const { props, decisionId, ...rest } = op.node;
        added.set(op.node.id, op.node.type);
        const node: UiNode = { ...rest, props: normalize(op.node.type, props), status: "draft", ...withDecision(decisionId), children: [] };
        return [{ ...op, node }];
      }
      case "update": {
        const { props, decisionId, ...rest } = op;
        const type = added.get(op.id) ?? (proto ? findNode(proto, op.id)?.type : undefined);
        const kept = props ? normalize(type, props) : undefined;
        // Every prop it set was dropped: what is left would only retag the node with the batch's
        // decision (sending an agreed node back to draft) for a change nobody can see. Its own
        // decisionId is a deliberate retag, so that op stays, and so does an update to a node that
        // does not exist (unknown type), so the batch still fails validation.
        if (type !== undefined && props !== undefined && Object.keys(kept!).length === 0 && decisionId === undefined) return [];
        return [{ ...rest, ...(kept ? { props: kept } : {}), ...withDecision(decisionId) }];
      }
      case "set_theme": {
        const values: Partial<Record<ThemeSlotName, string>> = {};
        for (const slot of THEME_SLOTS as ThemeSlotName[]) if (op[slot] !== undefined) values[slot] = op[slot];
        // No slot set, or no decision to agree or drop it: dropped, never a reason to reject the batch.
        if (Object.keys(values).length === 0 || batchDecision === undefined) {
          dropped++;
          return [];
        }
        return [{ op: "set_theme", values, ...withDecision(undefined) }];
      }
      case "drop_theme":
        return [{ op: "theme_status", decisionId: op.decisionId, to: "revert" }];
      default:
        return [op];
    }
  });
  const batch: PatchBatch = { ops, label: t.label };
  if (t.by !== undefined) batch.by = t.by;
  return { batch, dropped };
}
