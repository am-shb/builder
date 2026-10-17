import { z } from "zod";

export const COMPONENT_TYPES = [
  "App", "Screen", "NavBar", "Tabs", "Stack", "Card", "Text", "Heading", "Button", "Input",
  "Select", "Toggle", "Checkbox", "List", "ListItem", "Table", "Badge", "Modal",
  "ImagePlaceholder", "ChartPlaceholder", "EmptyState",
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

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

export const PropValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export const Props = z.record(z.string(), PropValue);
export const NodeStatus = z.enum(["draft", "agreed"]);

export type UiNode = {
  id: string;
  type: ComponentType;
  props: Record<string, string | number | boolean | string[]>;
  on?: { click?: Interaction[]; change?: Interaction[] };
  status: "draft" | "agreed";
  decisionId?: string;
  children: UiNode[];
};

export const UiNode: z.ZodType<UiNode> = z.strictObject({
  id: NodeId,
  type: z.enum(COMPONENT_TYPES),
  props: Props,
  on: z.strictObject({
    click: z.array(Interaction).optional(),
    change: z.array(Interaction).optional(),
  }).optional(),
  status: NodeStatus,
  decisionId: z.string().optional(),
  children: z.array(z.lazy(() => UiNode)),
});

export const Prototype = z.strictObject({
  root: UiNode,
  currentScreen: NodeId,
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
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const PatchBatch = z.strictObject({
  ops: z.array(PatchOp),
  label: z.string().max(60),
  by: z.string().optional(),
});
export type PatchBatch = z.infer<typeof PatchBatch>;

export type Change = {
  kind: "added" | "removed" | "moved" | "updated" | "screen";
  id: string;
  label: string;
  by?: string;
};

/** JSON Schema for strict tool use. The free-form `props` map is the one object without a closed key set. */
export function patchBatchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PatchBatch, { target: "draft-7" }) as Record<string, unknown>;
}
