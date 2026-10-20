import { z } from "zod";
import { THEME_OPTIONS } from "../../public/renderer/theme.js";
import { COMPONENT_TYPES as CATALOG_TYPES } from "../../public/renderer/catalog.js";

// The catalog (public/renderer/catalog.js) is the one list of component types.
export const COMPONENT_TYPES = CATALOG_TYPES as [string, ...string[]];
export type ComponentType = string;
const ComponentTypeSchema = z.enum(COMPONENT_TYPES);

export const MAX_DEPTH = 12;
export const MAX_NODES = 400;

const NodeId = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/);

export const Interaction = z.union([
  z.strictObject({ kind: z.literal("navigate"), screen: NodeId }),
  z.strictObject({ kind: z.literal("toggle"), target: NodeId }),
  z.strictObject({ kind: z.literal("open"), target: NodeId }),
  z.strictObject({ kind: z.literal("close"), target: NodeId }),
  z.strictObject({ kind: z.literal("append"), list: NodeId, fromInput: NodeId }),
  z.strictObject({ kind: z.literal("setValue"), target: NodeId, value: z.string() }),
]);
export type Interaction = z.infer<typeof Interaction>;

export const PropValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]);
export const Props = z.record(z.string(), PropValue);
export const NodeStatus = z.enum(["draft", "agreed"]);

export type UiNode = {
  id: string;
  type: ComponentType;
  props: Record<string, string | number | boolean | string[] | number[]>;
  on?: { click?: Interaction[]; change?: Interaction[] };
  status: "draft" | "agreed";
  decisionId?: string;
  children: UiNode[];
};

export const UiNode: z.ZodType<UiNode> = z.strictObject({
  id: NodeId,
  type: ComponentTypeSchema,
  props: Props,
  on: z.strictObject({
    click: z.array(Interaction).optional(),
    change: z.array(Interaction).optional(),
  }).optional(),
  status: NodeStatus,
  decisionId: z.string().optional(),
  children: z.array(z.lazy(() => UiNode)),
});

export type ThemeSlotName = "accent" | "warmth" | "radius" | "density";
// `reverted`: the proposal an objection took off this slot, put back if its decision is agreed later.
export type ThemeSlot = {
  value: string; status: "draft" | "agreed"; decisionId?: string; previous: string;
  reverted?: { value: string; decisionId: string };
};
export type Theme = Record<ThemeSlotName, ThemeSlot>;

const themeSlotSchema = (slot: ThemeSlotName) => {
  const option = z.string().refine((v) => THEME_OPTIONS[slot].includes(v), { message: `unknown ${slot} value` });
  return z.strictObject({
    value: option, status: NodeStatus, decisionId: z.string().optional(), previous: option,
    reverted: z.strictObject({ value: option, decisionId: z.string() }).optional(),
  });
};

export const Theme: z.ZodType<Theme> = z.strictObject({
  accent: themeSlotSchema("accent"),
  warmth: themeSlotSchema("warmth"),
  radius: themeSlotSchema("radius"),
  density: themeSlotSchema("density"),
});

const themeValueSchema = (slot: ThemeSlotName) =>
  z.string().refine((v) => THEME_OPTIONS[slot].includes(v), { message: `unknown ${slot} value` }).optional();

export const Prototype = z.strictObject({
  root: UiNode,
  currentScreen: NodeId,
  // Absent means the house theme, all agreed.
  theme: Theme.optional(),
});
export type Prototype = z.infer<typeof Prototype>;

export const PatchOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), parentId: NodeId, index: z.number().int().min(0).optional(), node: UiNode }),
  z.strictObject({
    op: z.literal("update"), id: NodeId, props: Props.optional(),
    status: NodeStatus.optional(), decisionId: z.string().optional(),
  }),
  z.strictObject({ op: z.literal("remove"), id: NodeId }),
  z.strictObject({ op: z.literal("move"), id: NodeId, parentId: NodeId, index: z.number().int().min(0) }),
  z.strictObject({ op: z.literal("set_screen"), screenId: NodeId }),
  z.strictObject({
    op: z.literal("set_theme"),
    values: z.strictObject({
      accent: themeValueSchema("accent"),
      warmth: themeValueSchema("warmth"),
      radius: themeValueSchema("radius"),
      density: themeValueSchema("density"),
    }).refine((v) => Object.values(v).some((x) => x !== undefined), { message: "values must set at least one slot" }),
    decisionId: z.string().optional(),
  }),
  z.strictObject({ op: z.literal("theme_status"), decisionId: z.string(), to: z.enum(["agreed", "revert"]) }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const PatchBatch = z.strictObject({
  ops: z.array(PatchOp),
  label: z.string().max(60),
  by: z.string().optional(),
});
export type PatchBatch = z.infer<typeof PatchBatch>;

export type Change = {
  kind: "added" | "removed" | "moved" | "updated" | "screen" | "theme";
  id: string;
  label: string;
  by?: string;
};

/**
 * Model-facing shapes. Strict tool schemas need closed objects and no recursion, so props are
 * key/value pairs and nodes carry no children (deeper structure comes from later `add` ops).
 * Nodes carry no status (every node the model adds is a draft), and a batch names its decision
 * once, with a per-node or per-op override. `fromToolBatch` in tree.ts converts these to the
 * internal PatchBatch.
 */
export const ToolProp = z.strictObject({ key: z.string(), value: PropValue });
export type ToolProp = z.infer<typeof ToolProp>;

export const ToolNode = z.strictObject({
  id: NodeId,
  type: ComponentTypeSchema,
  props: z.array(ToolProp),
  on: z.strictObject({
    click: z.array(Interaction).optional(),
    change: z.array(Interaction).optional(),
  }).optional(),
  decisionId: z.string().optional(),
});
export type ToolNode = z.infer<typeof ToolNode>;

const toolThemeValue = (slot: ThemeSlotName) => z.enum(THEME_OPTIONS[slot] as [string, ...string[]]).optional();

export const ToolPatchOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), parentId: NodeId, index: z.number().int().min(0).optional(), node: ToolNode }),
  z.strictObject({ op: z.literal("update"), id: NodeId, props: z.array(ToolProp).optional(), decisionId: z.string().optional() }),
  z.strictObject({ op: z.literal("remove"), id: NodeId }),
  z.strictObject({ op: z.literal("move"), id: NodeId, parentId: NodeId, index: z.number().int().min(0) }),
  z.strictObject({ op: z.literal("set_screen"), screenId: NodeId }),
  z.strictObject({
    op: z.literal("set_theme"),
    accent: toolThemeValue("accent"), warmth: toolThemeValue("warmth"),
    radius: toolThemeValue("radius"), density: toolThemeValue("density"),
  }),
  z.strictObject({ op: z.literal("drop_theme"), decisionId: z.string() }),
]);
export type ToolPatchOp = z.infer<typeof ToolPatchOp>;

export const ToolPatchBatch = z.strictObject({
  ops: z.array(ToolPatchOp),
  label: z.string().max(60),
  by: z.string().optional(),
  decisionId: z.string().optional(),
});
export type ToolPatchBatch = z.infer<typeof ToolPatchBatch>;

/** JSON Schema of the model-facing batch: every object closed, no $ref. */
export function patchBatchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ToolPatchBatch, { target: "draft-7" }) as Record<string, unknown>;
}
