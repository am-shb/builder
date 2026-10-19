// Frames: the containers a screen is laid out with.
import { h, str, arr, clampInt, setText, setHidden, setOptional, setAttr, setVariant, withParts, syncTexts } from "@renderer/components/dom.js";

/** Title + subtitle block used by Section and Card. */
function head(cls) {
  const el = h("div", `${cls}-head`);
  const title = h("div", `${cls}-title`);
  const subtitle = h("div", `${cls}-subtitle`);
  el.append(title, subtitle);
  return { el, title, subtitle };
}

function syncHead(parts, node) {
  const title = str(node.props.title);
  const subtitle = str(node.props.subtitle);
  setOptional(parts.title, title);
  setOptional(parts.subtitle, subtitle);
  setHidden(parts.head, !title && !subtitle);
}

/** Drawer and Modal: shown when opened by an interaction, else by their `open` prop. */
function overlay(cls) {
  return {
    create() {
      const el = h("div", `b-overlay ${cls}`);
      const box = h("div", `${cls}-box`);
      const title = h("div", `${cls}-title`);
      const body = h("div", `${cls}-body`);
      box.append(title, body);
      el.append(box);
      return withParts(el, { title, body });
    },
    update(el, node, ui) {
      setOptional(el.parts.title, str(node.props.title));
      setHidden(el, !(ui.open[node.id] ?? node.props.open === true));
    },
    slot: (el) => el.parts.body,
  };
}

export const FRAMES = {
  App: {
    create() {
      const el = h("div", "b-app");
      const bar = h("div", "b-app-bar");
      const logo = h("span", "b-app-logo");
      const title = h("span", "b-app-title");
      bar.append(logo, title);
      const body = h("div", "b-app-body");
      el.append(bar, body);
      return withParts(el, { bar, title, body });
    },
    update(el, node) {
      const title = str(node.props.title);
      setText(el.parts.title, title);
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

  PageHeader: {
    create() {
      const el = h("header", "b-pagehead");
      const text = h("div", "b-pagehead-text");
      const title = h("h1", "b-pagehead-title");
      const subtitle = h("p", "b-pagehead-subtitle");
      text.append(title, subtitle);
      const actions = h("div", "b-pagehead-actions");
      el.append(text, actions);
      return withParts(el, { title, subtitle, actions });
    },
    update(el, node) {
      setText(el.parts.title, str(node.props.title));
      setOptional(el.parts.subtitle, str(node.props.subtitle));
    },
    slot: (el) => el.parts.actions,
  },

  Section: {
    create() {
      const el = h("section", "b-section");
      const { el: hd, title, subtitle } = head("b-section");
      const body = h("div", "b-section-body");
      el.append(hd, body);
      return withParts(el, { head: hd, title, subtitle, body });
    },
    update(el, node) {
      syncHead(el.parts, node);
    },
    slot: (el) => el.parts.body,
  },

  Card: {
    create() {
      const el = h("div", "b-card b-panel");
      const { el: hd, title, subtitle } = head("b-card");
      const body = h("div", "b-card-body");
      el.append(hd, body);
      return withParts(el, { head: hd, title, subtitle, body });
    },
    update(el, node) {
      syncHead(el.parts, node);
    },
    slot: (el) => el.parts.body,
  },

  Grid: {
    create: () => h("div", "b-grid"),
    update(el, node) {
      setVariant(el, "is-cols-", ["2", "3", "4"].includes(str(node.props.columns)) ? str(node.props.columns) : "");
    },
    slot: (el) => el,
  },

  Row: {
    create: () => h("div", "b-row"),
    update(el, node) {
      const align = str(node.props.align);
      setVariant(el, "is-align-", ["start", "center", "end", "between"].includes(align) ? align : "");
    },
    slot: (el) => el,
  },

  Split: {
    create: () => h("div", "b-split"),
    update(el, node) {
      const ratio = { "1:1": "even", "2:1": "wide-left", "1:2": "wide-right" }[str(node.props.ratio)] ?? "even";
      setVariant(el, "is-ratio-", ratio);
    },
    slot: (el) => el,
  },

  Tabs: {
    create() {
      const el = h("div", "b-tabs");
      const bar = h("div", "b-tabs-bar");
      bar.setAttribute("role", "tablist");
      const body = h("div", "b-tabs-body");
      el.append(bar, body);
      return withParts(el, { bar, body });
    },
    update(el, node) {
      const labels = arr(node.props.tabs);
      const active = clampInt(node.props.active, 0, Math.max(0, labels.length - 1), 0);
      syncTexts(el.parts.bar, labels, (t) => {
        const tab = h("span", "b-tab", t);
        tab.setAttribute("role", "tab");
        return tab;
      });
      [...el.parts.bar.children].forEach((c, i) => {
        c.classList.toggle("is-active", i === active);
        setAttr(c, "aria-selected", String(i === active));
      });
      // The body shows the child at the active index (theme.css); with no tabs, all children show.
      setAttr(el, "data-active", labels.length ? String(active) : null);
    },
    slot: (el) => el.parts.body,
  },

  Drawer: overlay("b-drawer"),
  Modal: overlay("b-modal"),
};
