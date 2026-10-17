// Keyed reconcile of a Prototype into the DOM. Elements are reused by data-node-id, so
// re-rendering an unchanged prototype creates, moves and removes nothing.
import { buildElement, updateElement, slotOf } from "@renderer/components.js";
export { initialUiState } from "@renderer/interact.js";

const registry = new WeakMap(); // container -> Map<id, element> from the previous render

export function renderTree(container, proto, uiState) {
  const prev = registry.get(container) ?? new Map();
  const next = new Map();

  function place(parent, el, index) {
    if (parent.children[index] !== el) parent.insertBefore(el, parent.children[index] ?? null);
  }

  function visit(node, parent, index) {
    let el = prev.get(node.id);
    if (el && el.dataset.type !== node.type) el = undefined; // same id, different component: rebuild
    if (!el) el = buildElement(node);
    next.set(node.id, el);
    updateElement(el, node, uiState);
    place(parent, el, index);
    const slot = slotOf(el, node);
    if (slot) node.children.forEach((child, i) => visit(child, slot, i));
  }

  visit(proto.root, container, 0);

  // Whatever was not visited (or was rebuilt) leaves the DOM.
  for (const [id, el] of prev) if (next.get(id) !== el) el.remove();

  registry.set(container, next);
  return next;
}
