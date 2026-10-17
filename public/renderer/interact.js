// Declarative interactions. Pure and import-free: Node loads this file server-side as well.
// UI state: { screen, toggles, open, lists, values } -- all keyed by node id.

/** @returns {{ screen: string, toggles: Record<string, boolean>, open: Record<string, boolean>, lists: Record<string, string[]>, values: Record<string, string> }} */
export function initialUiState(proto) {
  return { screen: proto.currentScreen, toggles: {}, open: {}, lists: {}, values: {} };
}

export function findNode(proto, id) {
  const stack = [proto.root];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    for (const c of n.children) stack.push(c);
  }
  return undefined;
}

/** Returns a new state; never mutates the input. */
export function reduceInteraction(state, interaction, proto) {
  switch (interaction.kind) {
    case "navigate":
      return { ...state, screen: interaction.screen };
    case "toggle": {
      // Until first toggled, the displayed value comes from the node's own props.
      let current = state.toggles[interaction.target];
      if (current === undefined) {
        const p = (proto && findNode(proto, interaction.target))?.props ?? {};
        current = (p.on ?? p.checked) === true;
      }
      return { ...state, toggles: { ...state.toggles, [interaction.target]: !current } };
    }
    case "open":
      return { ...state, open: { ...state.open, [interaction.target]: true } };
    case "close":
      return { ...state, open: { ...state.open, [interaction.target]: false } };
    case "setValue":
      return { ...state, values: { ...state.values, [interaction.target]: interaction.value } };
    case "append": {
      const text = String(state.values[interaction.fromInput] ?? "").trim();
      if (!text) return state;
      return {
        ...state,
        lists: { ...state.lists, [interaction.list]: [...(state.lists[interaction.list] ?? []), text] },
        values: { ...state.values, [interaction.fromInput]: "" },
      };
    }
    default:
      return state;
  }
}

function runAll(state, interactions, proto) {
  return interactions.reduce((s, i) => reduceInteraction(s, i, proto), state);
}

// Clicks run the nearest ancestor's on.click; typing updates the input's value and runs on.change.
// Toggle and Checkbox also flip their own state on click.
export function bindInteractions(container, getProto, getState, setState) {
  const owner = (el) => (el && el.closest ? el.closest("[data-node-id]") : null);

  container.addEventListener("click", (e) => {
    const proto = getProto();
    let el = owner(e.target);
    while (el && container.contains(el)) {
      const node = findNode(proto, el.dataset.nodeId);
      if (node) {
        const flips = node.type === "Toggle" || node.type === "Checkbox";
        const handlers = node.on?.click ?? [];
        if (flips || handlers.length) {
          let next = getState();
          if (flips) next = reduceInteraction(next, { kind: "toggle", target: node.id }, proto);
          setState(runAll(next, handlers, proto));
          return;
        }
      }
      el = owner(el.parentElement);
    }
  });

  container.addEventListener("input", (e) => {
    const el = owner(e.target);
    if (!el || !container.contains(el)) return;
    const proto = getProto();
    const node = findNode(proto, el.dataset.nodeId);
    if (!node) return;
    const next = reduceInteraction(getState(), { kind: "setValue", target: node.id, value: e.target.value }, proto);
    setState(runAll(next, node.on?.change ?? [], proto));
  });
}
