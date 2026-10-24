import type { PatchBatch, ToolPatchBatch } from "./schema.ts";

// Node ids a variant's patches add, update, remove or move. The App root and Screens are too broad to show
// that a decision is about the same thing, and an update that changes no prop and no decision touches nothing.
export function touchedNodeIds(batch: ToolPatchBatch | PatchBatch, screens: Set<string>): Set<string> {
  const ids = new Set<string>();
  const broad = (id: string) => id === "app" || screens.has(id);
  for (const op of batch.ops) {
    if (op.op === "add") {
      const collect = (n: { id: string; type?: string; children?: unknown[] }) => {
        if (n.type !== "Screen" && !broad(n.id)) ids.add(n.id);
        for (const c of n.children ?? []) collect(c as typeof n);
      };
      collect(op.node);
    } else if (op.op === "update") {
      if ((op.props !== undefined || op.decisionId !== undefined) && !broad(op.id)) ids.add(op.id);
    } else if ((op.op === "remove" || op.op === "move") && !broad(op.id)) ids.add(op.id);
  }
  return ids;
}

