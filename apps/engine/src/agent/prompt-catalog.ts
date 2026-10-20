import { readFileSync } from "node:fs";
import { CATALOG, STYLE_OPTIONS, TEMPLATES } from "../../public/renderer/catalog.js";
import { PHONE_TABS } from "../../public/renderer/interact.js";
import { ICON_ALIASES, ICON_NAMES } from "../../public/renderer/icons.js";
import { THEME_OPTIONS } from "../../public/renderer/theme.js";

// The build prompt's component and theme reference, generated from the catalog so the prompt can
// never drift from what the server accepts. Pure and deterministic: the text is the same on every
// call, so the cached system prompt still hits.

const GROUPS = ["frames", "data", "content", "input", "feedback", "conversation"] as const;

type Kind = string | string[];

const KIND_WORDS: Record<string, string> = { s: "string", n: "number", b: "boolean", ss: "string[]", ns: "number[]" };

const kindText = (kind: Kind) => (Array.isArray(kind) ? kind.join("|") : KIND_WORDS[kind] ?? kind);

/** Markdown table, one row per component grouped by catalog group, then the style options and the types that hold children. */
export function componentTable(): string {
  const entries = Object.entries(CATALOG);
  const rows: string[] = ["| Type | props (key: kind or a|b|c) | styles | note |", "|---|---|---|---|"];
  for (const group of GROUPS) {
    for (const [type, entry] of entries) {
      if (entry.group !== group) continue;
      const props = Object.entries(entry.props as Record<string, Kind>).map(([k, kind]) => `${k}: ${kindText(kind)}`).join(", ");
      rows.push(`| \`${type}\` | ${props || "none"} | ${entry.styles.join(", ") || "-"} | ${entry.note} |`);
    }
  }
  const styles = Object.entries(STYLE_OPTIONS).map(([k, v]) => `${k}: ${v.join("|")}`).join("; ");
  const parents = entries.filter(([, e]) => e.children).map(([t]) => t).join(", ");
  return [
    ...rows,
    "",
    "Every type except App and Screen also takes `region: string`, the region of its Screen's template to sit in.",
    `Style options (optional; the first value is the default): ${styles}.`,
    `Only these hold child nodes: ${parents}. Every other type is a leaf.`,
  ].join("\n");
}

/** Markdown table of the Screen templates: regions (the one unplaced children fall into marked main) and what usually goes where. */
export function templatesTable(): string {
  const rows = ["| Template | regions | suggest |", "|---|---|---|"];
  for (const [name, t] of Object.entries(TEMPLATES)) {
    const regions = Object.keys(t.regions).map((r) => (r === t.main ? `${r} (main)` : r)).join(", ");
    rows.push(`| \`${name}\` | ${regions} | ${t.suggest} |`);
  }
  return rows.join("\n");
}

/** The theme slots and their values, first value being the house default. */
export function themeOptions(): string {
  return Object.entries(THEME_OPTIONS).map(([slot, values]) => `- ${slot}: ${values.join("|")}`).join("\n");
}

/** Every icon name the renderer draws, on one line, with a few aliases. */
export function iconList(): string {
  const aliases = ["chart", "money", "cart", "team", "dashboard", "delete", "edit"].filter((a) => a in ICON_ALIASES);
  return `${(ICON_NAMES as string[]).join(", ")}. Also accepted: ${aliases.map((a) => `${a} (${ICON_ALIASES[a as keyof typeof ICON_ALIASES]})`).join(", ")}.`;
}

/** build.md with the generated reference filled in. */
export function buildSystemPrompt(): string {
  return readFileSync(new URL("./prompts/build.md", import.meta.url), "utf8")
    .replace("{{COMPONENTS}}", () => componentTable())
    .replace("{{PHONE_NOTE}}", () => `A phone shows only its first ${PHONE_TABS} Screens as bottom tabs, so keep a phone app to ${PHONE_TABS} Screens.`)
    .replace("{{TEMPLATES}}", () => templatesTable())
    .replace("{{ICONS}}", () => iconList())
    .replace("{{THEME}}", () => themeOptions());
}
