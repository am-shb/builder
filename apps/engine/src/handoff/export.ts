// Handoff page generation. One template (public/handoff.html) serves two modes:
// live (renderer modules loaded from /renderer/) and export (a single file with the
// renderer modules and theme inlined, so it opens from disk with no network).
// All doc and prototype text is escaped here; nothing is ever interpolated as markup.
import { readFileSync } from "node:fs";
import type { ConsensusDoc } from "../consensus/doc.ts";
import { withAgreedTheme } from "../ui/tree.ts";
import type { Interaction, Prototype, UiNode } from "../ui/schema.ts";

const rendererDir = new URL("../../public/renderer/", import.meta.url);
// The handoff's import graph: render.js -> components (-> catalog, components/*), motion (-> clock), interact.
// Modules import each other as "@renderer/<path>", which the inline export maps to data URLs one by one.
export const RENDERER_MODULES = [
  "render.js", "components.js", "motion.js", "clock.js", "interact.js", "catalog.js", "theme.js",
  "components/dom.js", "components/frames.js", "components/data.js", "components/content.js", "components/input.js",
  "components/feedback.js",
] as const;

let cache: { template: string; theme: string; modules: Record<string, string> } | undefined;
function assets() {
  cache ??= {
    template: readFileSync(new URL("../../public/handoff.html", import.meta.url), "utf8"),
    theme: readFileSync(new URL("theme.css", rendererDir), "utf8"),
    modules: Object.fromEntries(RENDERER_MODULES.map((m) => [m, readFileSync(new URL(m, rendererDir), "utf8")])),
  };
  return cache;
}

const esc = (v: unknown) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// JSON inside <script type="application/json">: "<" can never open a tag, and U+2028/9 stay literal-safe.
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));

const FLAG = `<span class="flag">Not agreed</span>`;

function describe(i: Interaction): string {
  switch (i.kind) {
    case "navigate": return `navigate to ${i.screen}`;
    case "toggle": return `toggle ${i.target}`;
    case "open": return `open ${i.target}`;
    case "close": return `close ${i.target}`;
    case "append": return `append ${i.fromInput} to ${i.list}`;
    case "setValue": return `set ${i.target} to "${i.value}"`;
  }
}

function propsHtml(n: UiNode): string {
  const entries = Object.entries(n.props);
  if (!entries.length) return "";
  return `<dl class="props">${entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") : v)}</dd>`).join("")}</dl>`;
}

function interactionsHtml(n: UiNode): string {
  const rows = (["click", "change"] as const).flatMap((ev) =>
    (n.on?.[ev] ?? []).map((i) => `<li><span class="ev">on ${ev}</span> ${esc(describe(i))}</li>`));
  return rows.length ? `<ul class="interactions">${rows.join("")}</ul>` : "";
}

function nodeHtml(n: UiNode): string {
  const draft = n.status !== "agreed";
  const kids = n.children.length ? `<ul class="tree">${n.children.map(nodeHtml).join("")}</ul>` : "";
  return `<li class="node${draft ? " is-draft" : ""}"><div class="node-head"><span class="type">${esc(n.type)}</span> <code>${esc(n.id)}</code>${draft ? ` ${FLAG}` : ""}</div>${propsHtml(n)}${interactionsHtml(n)}${kids}</li>`;
}

function flatten(n: UiNode): UiNode[] {
  return [n, ...n.children.flatMap(flatten)];
}

const when = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
const list = (items: string[]) => items.map((x) => `<li>${esc(x)}</li>`).join("");

// Who agreed. An agreed decision with nobody named was either a side-by-side pick whose backers were
// not heard in the grounding lines, or a pending one nobody objected to for 30 s (known issue M3).
function agreedBy(d: ConsensusDoc["decisions"][number], doc: ConsensusDoc): string {
  if (d.agreedBy.length) return esc(d.agreedBy.join(", "));
  if (d.status !== "agreed") return "nobody yet";
  const picked = doc.conflicts.some((c) => c.status === "resolved" && `d-${c.id}` === d.id);
  return picked ? "the room, picking between side-by-side options" : "no objection within 30 s";
}

function decisionHtml(d: ConsensusDoc["decisions"][number], doc: ConsensusDoc): string {
  const meta = [
    `<dt>Proposed by</dt><dd>${esc(d.proposedBy)}</dd>`,
    `<dt>Agreed by</dt><dd>${agreedBy(d, doc)}</dd>`,
    d.decidedAt ? `<dt>Decided</dt><dd>${esc(when(d.decidedAt))}</dd>` : "",
    d.affects.length ? `<dt>Affects</dt><dd>${esc(d.affects.join(", "))}</dd>` : "",
    d.rejectedOptions.length ? `<dt>Rejected options</dt><dd><ul>${list(d.rejectedOptions)}</ul></dd>` : "",
  ].join("");
  return `<li class="decision"><p class="decision-text">${esc(d.text)}${d.status !== "agreed" ? ` ${FLAG}` : ""}</p><dl class="meta">${meta}</dl></li>`;
}

function render(doc: ConsensusDoc, fullProto: Prototype, mode: { inline: true } | { inline: false; exportHref?: string }): string {
  const a = assets();
  const proto = withAgreedTheme(fullProto); // a draft theme slot shows its last agreed value
  const importMap = mode.inline
    ? { imports: Object.fromEntries(RENDERER_MODULES.map((m) => [`@renderer/${m}`, `data:text/javascript;base64,${Buffer.from(a.modules[m]).toString("base64")}`])) }
    : { imports: { "@renderer/": "/renderer/" } };
  const theme = mode.inline ? `<style>${a.theme.replace(/<\/style/gi, "<\\/style")}</style>` : `<link rel="stylesheet" href="/renderer/theme.css">`;

  const agreedDecisions = doc.decisions.filter((d) => d.status === "agreed");
  const draftDecisions = doc.decisions.filter((d) => d.status !== "agreed");
  const draftNodes = flatten(proto.root).filter((n) => n.status !== "agreed");

  const notAgreed = draftNodes.length || draftDecisions.length
    ? `${draftNodes.length ? `<h3>Components</h3><ul class="plain">${draftNodes.map((n) => `<li><span class="type">${esc(n.type)}</span> <code>${esc(n.id)}</code> ${FLAG}</li>`).join("")}</ul>` : ""}
${draftDecisions.length ? `<h3>Decisions</h3><ul class="decisions">${draftDecisions.map((d) => decisionHtml(d, doc)).join("")}</ul>` : ""}`
    : `<p class="none">Everything shown here was agreed.</p>`;

  const replacements: Record<string, string> = {
    "<!--TITLE-->": esc(doc.app.name ? `${doc.app.name} handoff` : "Builder handoff"),
    "<!--HEADING-->": esc(doc.app.name ?? "Prototype handoff"),
    "<!--PURPOSE-->": doc.app.purpose ? `<p class="sub">${esc(doc.app.purpose)}</p>` : "",
    "<!--IMPORTMAP-->": `<script type="importmap">${safeJson(importMap)}</script>`,
    "<!--THEME-->": theme,
    "<!--EXPORT-->": !mode.inline && mode.exportHref ? `<a class="btn" href="${esc(mode.exportHref)}" download>Download self-contained HTML</a>` : "",
    "<!--SPEC-->": `<ul class="tree root">${nodeHtml(proto.root)}</ul>`,
    "<!--DECISIONS-->": agreedDecisions.length ? `<ul class="decisions">${agreedDecisions.map((d) => decisionHtml(d, doc)).join("")}</ul>` : `<p class="none">No decisions agreed yet.</p>`,
    "<!--NOTAGREED-->": notAgreed,
    "<!--QUESTIONS-->": doc.openQuestions.length
      ? `<ul class="plain">${doc.openQuestions.map((q) => `<li>${esc(q.text)}${q.raisedBy ? ` <span class="by">raised by ${esc(q.raisedBy)}</span>` : ""}</li>`).join("")}</ul>`
      : `<p class="none">No open questions.</p>`,
    "<!--DATA-->": safeJson({ doc, proto }),
  };
  // Single pass so replaced content (user text) is never re-scanned for placeholders.
  return a.template.replace(/<!--([A-Z]+)-->/g, (m) => replacements[m] ?? m);
}

export function buildHandoffHtml(doc: ConsensusDoc, proto: Prototype, exportHref: string): string {
  return render(doc, proto, { inline: false, exportHref });
}

export function buildExportHtml(doc: ConsensusDoc, proto: Prototype): string {
  return render(doc, proto, { inline: true });
}
