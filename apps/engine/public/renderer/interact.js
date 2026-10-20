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

export const PHONE_TABS = 5;

/**
 * The app frame, derived from the App's own props and its Screens (never from model output): `kind` is
 * sidebar, top or none on a desktop, phone on a phone (whose bottom tabs ignore `nav`), and `items` holds one
 * nav item per Screen in tree order, at most PHONE_TABS on a phone. A Screen with no title is listed by its id.
 * @returns {{ kind: "sidebar" | "top" | "none" | "phone", items: { screen: string, title: string, icon: string }[] }}
 */
export function frameNav(app) {
  const props = app.props ?? {};
  const kind = props.device === "phone" ? "phone" : props.nav === "top" || props.nav === "none" ? props.nav : "sidebar";
  if (kind === "none") return { kind, items: [] };
  const screens = app.children.filter((c) => c.type === "Screen");
  const items = (kind === "phone" ? screens.slice(0, PHONE_TABS) : screens).map((s) => ({
    screen: s.id, title: screenTitle(s), icon: typeof s.props.icon === "string" ? s.props.icon : "",
  }));
  return { kind, items };
}

/** A Screen's name in the frame: its title, else its id. */
export function screenTitle(screen) {
  const t = screen.props?.title;
  return typeof t === "string" && t.trim() ? t : screen.id;
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

// A click on a frame nav item ([data-nav-screen]) navigates. Other clicks run the nearest ancestor's on.click; typing updates the input's value and runs on.change.
// Toggle and Checkbox also flip their own state on click.
export function bindInteractions(container, getProto, getState, setState) {
  const owner = (el) => (el && el.closest ? el.closest("[data-node-id]") : null);

  container.addEventListener("click", (e) => {
    const proto = getProto();
    // A frame nav item is not a prototype node: it navigates to its Screen, before any node gets the click.
    const item = e.target && e.target.closest ? e.target.closest("[data-nav-screen]") : null;
    if (item && container.contains(item)) {
      const screen = item.dataset.navScreen;
      if (findNode(proto, screen)) setState(reduceInteraction(getState(), { kind: "navigate", screen }, proto));
      return;
    }
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
