// One builder per COMPONENT_TYPES entry. A builder has:
//   create(node)          -> element (static structure only)
//   update(el, node, ui)  -> sync props/ui state into the element; idempotent, touches the DOM only on change
//   slot(el)              -> element that holds child nodes (omitted for leaf components)
// Every element carries data-node-id and data-type. Parts live on el.parts.

const str = (v, d = "") => (v === undefined || v === null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v.map(String) : []);

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setAttr(el, name, value) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function withParts(el, parts) {
  el.parts = parts;
  return el;
}

// Rebuilds a list of child elements only when their text changes (keeps stable DOM otherwise).
function syncTexts(parent, texts, make) {
  const have = [...parent.children];
  texts.forEach((t, i) => {
    if (have[i]) setText(have[i], t);
    else parent.append(make(t));
  });
  for (const extra of have.slice(texts.length)) extra.remove();
}

const BUILDERS = {
  App: {
    create() {
      const el = h("div", "b-app");
      const bar = h("div", "b-app-title");
      const body = h("div", "b-app-body");
      el.append(bar, body);
      return withParts(el, { bar, body });
    },
    update(el, node) {
      const title = str(node.props.title);
      setText(el.parts.bar, title);
      setHidden(el.parts.bar, !title);
    },
    slot: (el) => el.parts.body,
  },

  Screen: {
    create: () => h("section", "b-screen"),
    update(el, node, ui) {
      setHidden(el, ui.screen !== node.id);
    },
    slot: (el) => el,
  },

  NavBar: {
    create() {
      const el = h("nav", "b-navbar");
      const title = h("div", "b-navbar-title");
      const items = h("div", "b-navbar-items");
      el.append(title, items);
      return withParts(el, { title, items });
    },
    update(el, node) {
      setText(el.parts.title, str(node.props.title));
    },
    slot: (el) => el.parts.items,
  },

  Tabs: {
    create() {
      const el = h("div", "b-tabs");
      const bar = h("div", "b-tabs-bar");
      const body = h("div", "b-tabs-body");
      el.append(bar, body);
      return withParts(el, { bar, body });
    },
    update(el, node) {
      const labels = arr(node.props.tabs);
      const active = Number(node.props.active ?? 0);
      syncTexts(el.parts.bar, labels, (t) => h("span", "b-tab", t));
      [...el.parts.bar.children].forEach((c, i) => c.classList.toggle("is-active", i === active));
    },
    slot: (el) => el.parts.body,
  },

  Stack: {
    create: () => h("div", "b-stack"),
    update(el, node) {
      el.classList.toggle("is-row", node.props.direction === "row");
    },
    slot: (el) => el,
  },

  Card: {
    create() {
      const el = h("div", "b-card");
      const title = h("div", "b-card-title");
      const body = h("div", "b-card-body");
      el.append(title, body);
      return withParts(el, { title, body });
    },
    update(el, node) {
      const title = str(node.props.title);
      setText(el.parts.title, title);
      setHidden(el.parts.title, !title);
    },
    slot: (el) => el.parts.body,
  },

  Text: {
    create: () => h("p", "b-text"),
    update(el, node) {
      setText(el, str(node.props.text));
    },
  },

  Heading: {
    create: () => h("h2", "b-heading"),
    update(el, node) {
      setText(el, str(node.props.text));
      el.classList.toggle("is-sub", Number(node.props.level ?? 1) > 1);
    },
  },

  Button: {
    create() {
      const el = h("button", "b-button");
      el.type = "button";
      return el;
    },
    update(el, node) {
      setText(el, str(node.props.label, "Button"));
      el.classList.toggle("is-secondary", node.props.variant === "secondary");
    },
  },

  Input: {
    create() {
      const el = h("label", "b-input");
      const label = h("span", "b-input-label");
      const input = h("input", "b-input-field");
      input.type = "text";
      el.append(label, input);
      return withParts(el, { label, input });
    },
    update(el, node, ui) {
      const label = str(node.props.label);
      setText(el.parts.label, label);
      setHidden(el.parts.label, !label);
      setAttr(el.parts.input, "placeholder", str(node.props.placeholder));
      const value = ui.values[node.id] ?? str(node.props.value);
      if (el.parts.input.value !== value) el.parts.input.value = value;
    },
  },

  Select: {
    create() {
      const el = h("label", "b-select");
      const label = h("span", "b-input-label");
      const select = h("select", "b-select-field");
      el.append(label, select);
      return withParts(el, { label, select });
    },
    update(el, node, ui) {
      const label = str(node.props.label);
      setText(el.parts.label, label);
      setHidden(el.parts.label, !label);
      const options = arr(node.props.options);
      syncTexts(el.parts.select, options, (t) => h("option", "", t));
      const value = ui.values[node.id] ?? str(node.props.value, options[0] ?? "");
      if (el.parts.select.value !== value) el.parts.select.value = value;
    },
  },

  Toggle: {
    create() {
      const el = h("div", "b-toggle");
      el.setAttribute("role", "switch");
      el.tabIndex = 0;
      const track = h("span", "b-toggle-track");
      const label = h("span", "b-toggle-label");
      el.append(track, label);
      return withParts(el, { label });
    },
    update(el, node, ui) {
      const on = ui.toggles[node.id] ?? node.props.on === true;
      el.classList.toggle("is-on", on);
      setAttr(el, "aria-checked", String(on));
      setText(el.parts.label, str(node.props.label));
    },
  },

  Checkbox: {
    create() {
      const el = h("div", "b-checkbox");
      el.setAttribute("role", "checkbox");
      el.tabIndex = 0;
      const box = h("span", "b-checkbox-box");
      const label = h("span", "b-checkbox-label");
      el.append(box, label);
      return withParts(el, { box, label });
    },
    update(el, node, ui) {
      const on = ui.toggles[node.id] ?? node.props.checked === true;
      el.classList.toggle("is-on", on);
      setAttr(el, "aria-checked", String(on));
      setText(el.parts.box, on ? "✓" : "");
      setText(el.parts.label, str(node.props.label));
    },
  },

  List: {
    create() {
      const el = h("div", "b-list");
      el.setAttribute("role", "list");
      const items = h("div", "b-list-items");
      const added = h("div", "b-list-added");
      el.append(items, added);
      return withParts(el, { items, added });
    },
    update(el, node, ui) {
      syncTexts(el.parts.added, ui.lists[node.id] ?? [], (t) => {
        const item = h("div", "b-listitem is-added", t);
        item.dataset.listItem = "";
        return item;
      });
    },
    slot: (el) => el.parts.items,
  },

  ListItem: {
    create() {
      const el = h("div", "b-listitem");
      el.setAttribute("role", "listitem");
      const text = h("span", "b-listitem-text");
      const body = h("span", "b-listitem-body");
      el.append(text, body);
      return withParts(el, { text, body });
    },
    update(el, node) {
      setText(el.parts.text, str(node.props.text));
    },
    slot: (el) => el.parts.body,
  },

  Table: {
    create() {
      const el = h("table", "b-table");
      const head = h("thead");
      const body = h("tbody");
      el.append(head, body);
      return withParts(el, { head, body });
    },
    update(el, node) {
      const cols = arr(node.props.columns);
      const rows = arr(node.props.rows).map((r) => r.split("|").map((c) => c.trim()));
      const key = JSON.stringify([cols, rows]);
      if (el.dataset.key === key) return;
      el.dataset.key = key;
      const tr = h("tr");
      for (const c of cols) tr.append(h("th", "", c));
      el.parts.head.replaceChildren(tr);
      el.parts.body.replaceChildren(...rows.map((r) => {
        const row = h("tr");
        for (const c of r) row.append(h("td", "", c));
        return row;
      }));
    },
  },

  Badge: {
    create: () => h("span", "b-badge"),
    update(el, node) {
      setText(el, str(node.props.text));
    },
  },

  Modal: {
    create() {
      const el = h("div", "b-modal");
      const box = h("div", "b-modal-box");
      const title = h("div", "b-modal-title");
      const body = h("div", "b-modal-body");
      box.append(title, body);
      el.append(box);
      return withParts(el, { title, body });
    },
    update(el, node, ui) {
      setText(el.parts.title, str(node.props.title));
      setHidden(el, !(ui.open[node.id] ?? node.props.open === true));
    },
    slot: (el) => el.parts.body,
  },

  ImagePlaceholder: {
    create: () => h("div", "b-image"),
    update(el, node) {
      setText(el, str(node.props.label, "Image"));
    },
  },

  ChartPlaceholder: {
    create() {
      const el = h("div", "b-chart");
      const bars = h("div", "b-chart-bars");
      for (const hgt of [45, 70, 55, 90, 65]) {
        const b = h("span", "b-chart-bar");
        b.style.height = `${hgt}%`;
        bars.append(b);
      }
      const label = h("div", "b-chart-label");
      el.append(bars, label);
      return withParts(el, { label });
    },
    update(el, node) {
      setText(el.parts.label, str(node.props.label, "Chart"));
    },
  },

  EmptyState: {
    create() {
      const el = h("div", "b-empty");
      const title = h("div", "b-empty-title");
      const text = h("div", "b-empty-text");
      el.append(title, text);
      return withParts(el, { title, text });
    },
    update(el, node) {
      setText(el.parts.title, str(node.props.title, "Nothing here yet"));
      setText(el.parts.text, str(node.props.text));
    },
  },
};

export const COMPONENT_BUILDERS = BUILDERS;

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
