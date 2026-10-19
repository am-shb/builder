import axe from "axe-core";

// axe in jsdom: structure, names and roles. jsdom can't compute colors, so contrast is checked in a real browser by
// scripts/screenshots.ts instead.
export async function axeViolations(node: Element | Document = document): Promise<string[]> {
  const result = await axe.run(node, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}
