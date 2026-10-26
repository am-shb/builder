import axe from "axe-core";

// axe in jsdom: structure, names and roles. jsdom can't compute colors, so contrast is checked in a real browser by
// scripts/screenshots.ts instead. iframes: false because jsdom can't reach into a frame (the demo video's embed).
export async function axeViolations(node: Element | Document = document): Promise<string[]> {
  const result = await axe.run(node, { iframes: false, rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}
