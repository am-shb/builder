// Frames: the containers a screen is laid out with.
import { h, str, arr, clampInt, setText, setHidden, setOptional, setAttr, setClass, setVariant, withParts, syncTexts, changed } from "@renderer/components/dom.js";
import { frameNav, screenTitle } from "@renderer/interact.js";
import { TEMPLATES, templateRegion } from "@renderer/catalog.js";

/** Title + subtitle block used by Section and Card. */
function head(cls) {
  const el = h("div", `${cls}-head`);
  const title = h("div", `${cls}-title`);
  const subtitle = h("div", `${cls}-subtitle`);
  el.append(title, subtitle);
  return { el, title, subtitle };
}

// ---------- page templates ----------
// A templated Screen holds one container per region ([data-region], in the template's order) and is a CSS grid
// laid out from the template's areas and columns. Only regions with children are drawn: an empty one is hidden and
// left out of the areas, its cells going to the filled region beside it in the same row (a row with nothing filled
// goes), so an empty side column or footer takes no room. Emptiness comes from the node's children, which the
// reconcile places right after this update, so the layout is settled in one pass and a second render changes nothing.

// Out-of-flow children: they never take room in a region, so a region holding only these is drawn without a box.
const OVERLAYS = new Set(["Drawer", "Modal"]);

function templateOf(node) {
  const t = str(node.props.template);
  return Object.hasOwn(TEMPLATES, t) ? t : "";
}

/** grid-template-areas for `template` with only the regions in `filled`; "none" when nothing is filled. */
export function templateAreas(template, filled) {
  const rows = [...TEMPLATES[template].areas.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/));
  const out = [];
  for (const row of rows) {
    const cells = row.map((c) => (filled.has(c) ? c : ""));
    if (!cells.some(Boolean)) continue;
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) cells[i] = cells.slice(0, i).reverse().find(Boolean) ?? cells.slice(i + 1).find(Boolean);
    }
    out.push(`"${cells.join(" ")}"`);
  }
  return out.length ? out.join(" ") : "none";
}

// Builds the region containers when the template changes, reusing a container whose name the new template keeps.
// Children of a dropped container are detached here and re-placed by the reconcile on the same pass.
function syncRegions(el, template) {
  const regions = new Map();
  if (template) {
    for (const [name, r] of Object.entries(TEMPLATES[template].regions)) {
      const div = el.parts.regions.get(name) ?? h("div", "b-region");
      div.dataset.region = name;
      setVariant(div, "is-layout-", r.layout);
      div.style.gridArea = name;
      regions.set(name, div);
    }
  }
  for (const [name, div] of el.parts.regions) if (regions.get(name) !== div) div.remove();
  for (const div of regions.values()) el.append(div);
  el.parts.regions = regions;
  el.parts.template = template;
  el.style.gridTemplateColumns = template ? TEMPLATES[template].columns.split(/\s+/).map((c) => `minmax(0, ${c})`).join(" ") : "";
  el.parts.areas = "";
  el.style.gridTemplateAreas = "";
}

function syncEmptyRegions(el, node) {
  const template = el.parts.template;
  if (!template) return;
  const flow = new Set();
  const overlays = new Set();
  for (const c of node.children) (OVERLAYS.has(c.type) ? overlays : flow).add(templateRegion(template, c.props?.region));
  for (const [name, div] of el.parts.regions) {
    setHidden(div, !flow.has(name) && !overlays.has(name));
    setClass(div, "is-overlays", !flow.has(name) && overlays.has(name));
  }
  const areas = templateAreas(template, flow);
  if (el.parts.areas !== areas) {
    el.parts.areas = areas;
    el.style.gridTemplateAreas = areas;
  }
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
  // The app frame is derived from what exists: the App's title and one nav item per Screen. Nav items carry
  // data-nav-screen, not data-node-id: they are not prototype nodes (interact.js makes them navigate).
  //   .b-app.is-frame-<sidebar|top|none|phone>
  //     .b-app-frame (.b-phone on a phone)
  //       .b-app-chrome > .b-app-rail > .b-app-brand (logo, title) + .b-app-nav (items)
  //       .b-app-main > .b-app-screentitle (phone) + .b-app-body (the Screens)
  App: {
    create() {
      const el = h("div", "b-app");
      const frame = h("div", "b-app-frame");
      const chrome = h("div", "b-app-chrome");
      const rail = h("div", "b-app-rail");
      const brand = h("div", "b-app-brand");
      const logo = h("span", "b-app-logo");
      const title = h("span", "b-app-title");
      brand.append(logo, title);
      const nav = h("nav", "b-app-nav");
      rail.append(brand, nav);
      chrome.append(rail);
      const main = h("div", "b-app-main");
      const screenTitle = h("div", "b-app-screentitle");
      const body = h("div", "b-app-body");
      main.append(screenTitle, body);
      frame.append(chrome, main);
      el.append(frame);
      return withParts(el, { frame, chrome, title, nav, screenTitle, body });
    },
    update(el, node, ui) {
      const { kind, items } = frameNav(node);
      setVariant(el, "is-frame-", kind);
      setClass(el.parts.frame, "b-phone", kind === "phone");
      setOptional(el.parts.title, str(node.props.title));
      // Items are rebuilt only when the screen list (ids, titles, icons) changes; the active one follows ui.screen.
      const nav = el.parts.nav;
      if (changed(nav, JSON.stringify(items))) {
        nav.replaceChildren(...items.map((it) => {
          const item = h("a", "b-app-navitem");
          item.dataset.navScreen = it.screen;
          item.append(h("span", "b-app-navicon"), h("span", "b-app-navlabel", it.title));
          return item;
        }));
      }
      for (const item of nav.children) {
        const on = item.dataset.navScreen === ui.screen;
        setClass(item, "is-active", on);
        setAttr(item, "aria-current", on ? "page" : null);
      }
      const shown = node.children.find((c) => c.type === "Screen" && c.id === ui.screen);
      setText(el.parts.screenTitle, kind === "phone" && shown ? screenTitle(shown) : "");
    },
    slot: (el) => el.parts.body,
  },

  // With a template: .b-screen.is-template-<name> > .b-region[data-region] (the children). Without: the children.
  Screen: {
    create: () => withParts(h("section", "b-screen"), { template: "", regions: new Map(), areas: "" }),
    update(el, node, ui) {
      setHidden(el, ui.screen !== node.id);
      const template = templateOf(node);
      setVariant(el, "is-template-", template);
      if (el.parts.template !== template) syncRegions(el, template);
      syncEmptyRegions(el, node);
    },
    slot: (el) => el,
    // A child goes to its region (an unknown or missing region to the template's main); without a template, to the Screen.
    slotFor(el, node, child) {
      const region = el.parts.template ? templateRegion(el.parts.template, child.props?.region) : null;
      return (region && el.parts.regions.get(region)) || el;
    },
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
