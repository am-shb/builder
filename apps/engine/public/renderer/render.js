// Keyed reconcile of a Prototype into the DOM. Elements are reused by data-node-id, so
// re-rendering an unchanged prototype creates, moves and removes nothing.
// Pass `changes` (a patch's Change[]; [] for a local interaction) to animate the difference.
import { buildElement, updateElement, slotOf, slotFor } from "@renderer/components.js";
import { themeValues, themeVars } from "@renderer/theme.js";
import { captureRects, animateReconcile, cloneForCrossFade } from "@renderer/motion.js";
export { initialUiState } from "@renderer/interact.js";

const registry = new WeakMap(); // container -> Map<id, element> from the previous render
const propsKey = new WeakMap(); // element -> JSON of the props it last showed

export function renderTree(container, proto, uiState, changes) {
  const prev = registry.get(container) ?? new Map();
  const next = new Map();
  const motion = Array.isArray(changes) && prev.size > 0;
  const prevRects = motion ? captureRects(prev) : null;
  const updated = motion ? new Set(changes.filter((c) => c.kind === "updated").map((c) => c.id)) : null;
  const previous = new Map(); // id -> { wasDraft, clone } for motion
  if (motion) container.classList.add("m-root");

  function place(parent, el, index) {
    if (parent.children[index] !== el) parent.insertBefore(el, parent.children[index] ?? null);
  }

  function visit(node, parent, index) {
    let el = prev.get(node.id);
    if (el && el.dataset.type !== node.type) el = undefined; // same id, different component: rebuild
    const key = JSON.stringify(node.props);
    if (!el) el = buildElement(node);
    else if (motion) {
      const wasDraft = el.classList.contains("is-draft");
      const edited = updated.has(node.id) && propsKey.get(el) !== key;
      if (edited || (wasDraft && node.status !== "draft")) {
        // A Screen draws nothing of its own (a template change moves its children, which glide): no cross-fade copy.
        previous.set(node.id, { wasDraft, clone: edited && node.type !== "Screen" ? cloneForCrossFade(el) : null });
      }
    }
    propsKey.set(el, key);
    next.set(node.id, el);
    updateElement(el, node, uiState);
    place(parent, el, index);
    // Each child goes to its container (slotFor: a templated Screen has one per region) at its index among the
    // children placed in that same container.
    if (!slotOf(el, node)) return;
    const placed = new Map(); // container -> children placed in it so far
    for (const child of node.children) {
      const slot = slotFor(el, node, child);
      const i = placed.get(slot) ?? 0;
      placed.set(slot, i + 1);
      visit(child, slot, i);
    }
  }

  visit(proto.root, container, 0);

  // The theme is a set of CSS custom properties on the App element, so each rendered prototype
  // (and each comparison preview) is themed on its own. Every key is always present.
  const app = next.get(proto.root.id);
  for (const [name, value] of Object.entries(themeVars(themeValues(proto.theme)))) {
    if (app.style.getPropertyValue(name) !== value) app.style.setProperty(name, value);
  }

  // Whatever was not visited (or was rebuilt) leaves the DOM; with motion it leaves animated.
  const removed = new Map();
  for (const [id, el] of prev) {
    if (next.get(id) === el) continue;
    if (motion) removed.set(id, el);
    else el.remove();
  }

  registry.set(container, next);
  if (motion) animateReconcile(prevRects, next, changes, { removed, previous });
  return next;
}
