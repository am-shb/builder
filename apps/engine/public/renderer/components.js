// One builder per component type. A builder has:
//   create(node)          -> element (static structure only)
//   update(el, node, ui)  -> sync props/ui state into the element; idempotent, touches the DOM only on change
//   slot(el)              -> element that holds child nodes (omitted for leaf components)
//   slotFor(el, node, child) -> optional: the element that holds this one child (a templated Screen's regions);
//                            used for every child when present, else slot(el)
// Every element carries data-node-id, data-type and the b-node class. Parts live on el.parts.
// The catalog's builders live in components/<group>.js; the style options a type declares (tone, size, pad,
// emphasis, span) are applied here, the same way for every type.
import { CATALOG, STYLE_OPTIONS } from "@renderer/catalog.js";
import { str, setVariant } from "@renderer/components/dom.js";
import { FRAMES } from "@renderer/components/frames.js";
import { DATA } from "@renderer/components/data.js";
import { CONTENT } from "@renderer/components/content.js";
import { INPUT } from "@renderer/components/input.js";
import { FEEDBACK } from "@renderer/components/feedback.js";

const BUILDERS = { ...FRAMES, ...DATA, ...CONTENT, ...INPUT, ...FEEDBACK };

export const COMPONENT_BUILDERS = BUILDERS;

const STYLE_CLASSES = ["tone", "size", "pad", "emphasis"];

// Style options render as classes (is-tone-accent, is-size-lg, …) and span as grid-column: span <v>.
// Only the options the type declares in the catalog apply; unknown values are ignored.
function applyStyles(el, node) {
  const styles = CATALOG[node.type]?.styles ?? [];
  for (const key of STYLE_CLASSES) {
    const v = styles.includes(key) ? str(node.props[key]) : "";
    setVariant(el, `is-${key}-`, STYLE_OPTIONS[key].includes(v) ? v : "");
  }
  const span = styles.includes("span") && STYLE_OPTIONS.span.includes(str(node.props.span)) ? str(node.props.span) : "";
  const column = span ? `span ${span}` : "";
  if (el.style.gridColumn !== column) el.style.gridColumn = column;
  if (span) {
    if (el.dataset.span !== span) el.dataset.span = span;
  } else if (el.dataset.span) {
    delete el.dataset.span;
  }
}

export function buildElement(node) {
  const b = BUILDERS[node.type];
  if (!b) throw new Error(`unknown component type: ${node.type}`);
  const el = b.create(node);
  el.dataset.nodeId = node.id;
  el.dataset.type = node.type;
  el.classList.add("b-node");
  return el;
}

export function updateElement(el, node, ui) {
  BUILDERS[node.type].update(el, node, ui);
  applyStyles(el, node);
  el.classList.toggle("is-draft", node.status === "draft");
  if (node.decisionId) {
    if (el.dataset.decisionId !== node.decisionId) el.dataset.decisionId = node.decisionId;
  } else if (el.dataset.decisionId) {
    delete el.dataset.decisionId;
  }
}

export function slotOf(el, node) {
  const s = BUILDERS[node.type].slot;
  return s ? s(el) : null;
}

/** Where one child of `node` goes: the builder's slotFor when it has one, else its slot. */
export function slotFor(el, node, child) {
  const b = BUILDERS[node.type];
  return b.slotFor ? b.slotFor(el, node, child) : slotOf(el, node);
}
