// Component catalog: the single source for props, style options and compact cell markup.
// Pure and import-free: Node loads this file server-side as well as the browser.
// Prop kinds: "s" string, "n" number, "b" boolean, "ss" string list, "ns" number list, or a list of allowed strings.

/** @typedef {"s"|"n"|"b"|"ss"|"ns"|string[]} PropKind */
/** @typedef {{ group: "frames"|"data"|"content"|"input"|"feedback"|"conversation", props: Record<string, PropKind>, styles: string[], children: boolean, note: string }} CatalogEntry */

/** @type {Record<"tone"|"size"|"pad"|"emphasis"|"span", string[]>} */
export const STYLE_OPTIONS = {
  tone: ["default", "accent", "success", "warning", "danger", "muted"],
  size: ["sm", "md", "lg"],
  pad: ["tight", "normal", "roomy"],
  emphasis: ["plain", "outlined", "filled"],
  span: ["1", "2", "3", "4"],
};

/** @typedef {{ layout: "stack"|"row"|"grid", note: string }} TemplateRegion */
/** @typedef {{ regions: Record<string, TemplateRegion>, main: string, areas: string, columns: string, suggest: string }} Template */

/** @type {Record<string, Template>} */
export const TEMPLATES = {
  dashboard: {
    regions: {
      header: { layout: "row", note: "page title and actions" },
      stats: { layout: "grid", note: "up to 4 headline numbers" },
      main: { layout: "stack", note: "charts and tables" },
      side: { layout: "stack", note: "recent activity" },
    },
    main: "main",
    areas: '"header header" "stats stats" "main side"',
    columns: "2fr 1fr",
    suggest: "PageHeader in header; StatCard in stats; ChartCard/Table in main; ActivityList in side",
  },
  "list-detail": {
    regions: {
      header: { layout: "row", note: "page title and actions" },
      list: { layout: "stack", note: "the items to pick from" },
      detail: { layout: "stack", note: "the picked item" },
    },
    main: "detail",
    areas: '"header header" "list detail"',
    columns: "1fr 1.6fr",
    suggest: "List/Table in list; Card/MediaCard in detail",
  },
  form: {
    regions: {
      header: { layout: "row", note: "page title and actions" },
      main: { layout: "stack", note: "the fields" },
      aside: { layout: "stack", note: "help beside the form" },
    },
    main: "main",
    areas: '"header header" "main aside"',
    columns: "2fr 1fr",
    suggest: "Input/Select/Toggle in main; help Card or Banner in aside",
  },
  feed: {
    regions: {
      header: { layout: "row", note: "page title and actions" },
      main: { layout: "stack", note: "the posts" },
      side: { layout: "stack", note: "people and extras" },
    },
    main: "main",
    areas: '"header header" "main side"',
    columns: "2fr 1fr",
    suggest: "MediaCard/Comment in main; AvatarGroup/Card in side",
  },
  landing: {
    regions: {
      hero: { layout: "stack", note: "the banner at the top" },
      features: { layout: "stack", note: "what the product does" },
      pricing: { layout: "grid", note: "up to 3 plans" },
      footer: { layout: "row", note: "closing links" },
    },
    main: "features",
    areas: '"hero" "features" "pricing" "footer"',
    columns: "1fr",
    suggest: "Hero in hero; FeatureGrid in features; PricingTier in pricing",
  },
  chat: {
    regions: {
      list: { layout: "stack", note: "conversations" },
      main: { layout: "stack", note: "the open conversation" },
    },
    main: "main",
    areas: '"list main"',
    columns: "1fr 2fr",
    suggest: "ActivityList/List in list; ChatThread in main",
  },
  checkout: {
    regions: {
      header: { layout: "row", note: "progress through the steps" },
      main: { layout: "stack", note: "the fields" },
      summary: { layout: "stack", note: "order totals" },
    },
    main: "main",
    areas: '"header header" "main summary"',
    columns: "1.6fr 1fr",
    suggest: "Steps in header; Input in main; Card with totals in summary",
  },
};

const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * Where a child of a templated Screen goes: its `region` if the template has it, else the template's main.
 * Null when the Screen has no (known) template.
 * @param {string|undefined} template @param {unknown} region @returns {string|null}
 */
export function templateRegion(template, region) {
  const t = template !== undefined && Object.hasOwn(TEMPLATES, template) ? TEMPLATES[template] : undefined;
  if (!t) return null;
  return typeof region === "string" && Object.hasOwn(t.regions, region) ? region : t.main;
}

/** @type {(group: CatalogEntry["group"], props: Record<string, PropKind>, styles: string[], children: boolean, note: string) => CatalogEntry} */
const e = (group, props, styles, children, note) => ({ group, props, styles, children, note });

/** @type {Record<string, CatalogEntry>} */
export const CATALOG = {
  App: e("frames", { title: "s", nav: ["sidebar", "top", "none"], device: ["desktop", "phone"] }, [], true, "Root of the prototype; holds Screens; the app frame and its navigation are drawn from the Screens"),
  Screen: e("frames", { title: "s", template: TEMPLATE_NAMES, icon: "s" }, [], true, "One page of the app; the stage shows one at a time; a template lays children out in regions"),
  PageHeader: e("frames", { title: "s", subtitle: "s" }, [], true, "Page title with subtitle; children are action buttons"),
  Section: e("frames", { title: "s", subtitle: "s" }, ["pad"], true, "Titled block that groups related content"),
  Card: e("frames", { title: "s", subtitle: "s" }, ["tone", "pad", "emphasis", "span"], true, "Bordered container for related content"),
  Grid: e("frames", { columns: ["2", "3", "4"] }, ["pad"], true, "Equal columns; children can set span"),
  Row: e("frames", { align: ["start", "center", "end", "between"] }, [], true, "Horizontal line of children"),
  Split: e("frames", { ratio: ["1:1", "2:1", "1:2"] }, [], true, "Two panes side by side, e.g. list and detail"),
  Tabs: e("frames", { tabs: "ss", active: "n" }, [], true, "Tab bar; one child per tab, active is the shown index"),
  Drawer: e("frames", { title: "s", open: "b" }, [], true, "Side panel that slides over the screen"),
  Modal: e("frames", { title: "s", open: "b" }, [], true, "Centered dialog over the screen"),

  StatCard: e("data", { label: "s", value: "s", delta: "s", trend: ["up", "down", "flat"], icon: "s" }, ["tone", "size", "span"], false, "One headline number with label and optional change"),
  Table: e("data", { columns: "ss", rows: "ss" }, ["span"], false, "Data table; each row is a cell string like \"@Sara | Seats | $420 | #Paid\""),
  ActivityList: e("data", { title: "s", items: "ss" }, ["span"], false, "Feed of recent events, \"@Name | what happened | when\""),
  ChartCard: e("data", { title: "s", kind: ["bar", "line", "donut"], data: "ns", labels: "ss" }, ["span"], false, "Chart with a title; data numbers and matching labels"),
  Progress: e("data", { label: "s", value: "n" }, ["tone"], false, "Progress bar, value 0 to 100"),
  Timeline: e("data", { items: "ss" }, [], false, "Vertical history, \"time | title | note\""),
  CalendarStrip: e("data", { days: "ss", active: "n" }, [], false, "Row of days with one active"),
  Kanban: e("data", { columns: "ss", cards: "ss" }, [], false, "Board of columns; cards are \"column | title | @person\""),
  List: e("data", {}, [], true, "Vertical list of ListItems"),
  ListItem: e("data", { text: "s", subtitle: "s", meta: "s", icon: "s", avatar: "s" }, ["tone"], true, "Row in a List with optional avatar, meta and actions"),

  Heading: e("content", { text: "s", level: "n" }, [], false, "Section or page heading, level 1 to 3"),
  Text: e("content", { text: "s" }, ["tone", "size"], false, "Paragraph of body text"),
  Hero: e("content", { title: "s", subtitle: "s", image: "s" }, ["tone"], true, "Large landing banner; children are call-to-action buttons"),
  FeatureGrid: e("content", { items: "ss" }, [], false, "Grid of features, \"icon | title | text\""),
  PricingTier: e("content", { name: "s", price: "s", period: "s", features: "ss", highlighted: "b" }, ["span"], true, "One pricing plan; children are the sign-up button"),
  ProductCard: e("content", { title: "s", price: "s", image: "s", rating: "n", badge: "s" }, ["span"], false, "Product with image, price and rating"),
  MediaCard: e("content", { title: "s", text: "s", image: "s", meta: "s" }, ["span"], false, "Article or media tile with image and text"),
  Image: e("content", { image: "s", label: "s", aspect: ["wide", "square", "tall"] }, ["span"], false, "Built-in picture chosen by subject word"),
  Avatar: e("content", { name: "s", subtitle: "s" }, ["size"], false, "Person initials with name"),
  AvatarGroup: e("content", { names: "ss" }, ["size"], false, "Overlapping avatars for a team"),
  Badge: e("content", { text: "s" }, ["tone"], false, "Small status label"),
  Quote: e("content", { text: "s", author: "s", role: "s" }, [], false, "Testimonial with attribution"),

  Button: e("input", { label: "s", variant: ["primary", "secondary", "ghost", "danger"], icon: "s" }, ["size"], false, "Clickable action"),
  Input: e("input", { label: "s", placeholder: "s", value: "s", icon: "s" }, [], false, "Single-line text field"),
  Search: e("input", { placeholder: "s" }, [], false, "Search box with magnifier"),
  Select: e("input", { label: "s", options: "ss", value: "s" }, [], false, "Dropdown with a list of options"),
  Segmented: e("input", { options: "ss", value: "s" }, [], false, "Pill switch between a few options"),
  Toggle: e("input", { label: "s", on: "b" }, [], false, "On/off switch"),
  Checkbox: e("input", { label: "s", checked: "b" }, [], false, "Checkable box with label"),
  Slider: e("input", { label: "s", value: "n" }, [], false, "Numeric range slider, 0 to 100"),
  DatePicker: e("input", { label: "s", value: "s" }, [], false, "Date field showing a date"),
  Steps: e("input", { steps: "ss", current: "n" }, [], false, "Wizard progress through named steps"),
  FileUpload: e("input", { label: "s", hint: "s" }, [], false, "Drop zone for attaching a file"),

  EmptyState: e("feedback", { title: "s", text: "s", icon: "s" }, [], true, "Placeholder when there is nothing yet; children are actions"),
  Banner: e("feedback", { title: "s", text: "s" }, ["tone"], false, "Full-width notice at the top of a block"),
  Toast: e("feedback", { text: "s" }, ["tone"], false, "Short confirmation message"),
  Skeleton: e("feedback", { lines: "n" }, [], false, "Loading placeholder with a number of lines"),

  ChatThread: e("conversation", { messages: "ss" }, [], false, "Chat bubbles, \"Name | message\"; name me aligns right"),
  Comment: e("conversation", { author: "s", text: "s", time: "s" }, [], false, "One comment with author and time"),
};

export const COMPONENT_TYPES = Object.keys(CATALOG);

/**
 * The types the build model is offered (ADR 0018), in catalog order. The renderer and the stored-tree
 * schema keep every type in CATALOG so old sessions still draw; only the prompt table and the tool
 * schema sent to the model list these.
 */
export const OFFERED_TYPES = [
  "App", "Screen", "PageHeader", "Card", "Grid",
  "StatCard", "Table", "ChartCard", "List", "ListItem",
  "Text", "ProductCard", "Image", "Badge", "Button",
];

/** Props of an offered type that the model is not told about (the renderer and normalizeProps still take them). */
export const OFFERED_PROPS_OMIT = { Screen: ["template"] };

/** @param {unknown} v @returns {string|undefined} */
function toStr(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** @param {unknown} v @returns {number|undefined} */
function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * @param {PropKind} kind @param {unknown} v
 * @returns {string|number|boolean|string[]|number[]|undefined} undefined means invalid
 */
function coerce(kind, v) {
  if (Array.isArray(kind)) {
    const s = toStr(v);
    return s !== undefined && kind.includes(s) ? s : undefined;
  }
  switch (kind) {
    case "s": return toStr(v);
    case "n": return toNum(v);
    case "b": return typeof v === "boolean" ? v : undefined;
    case "ss": {
      if (!Array.isArray(v)) return undefined;
      /** @type {string[]} */
      const out = [];
      for (const x of v) { const s = toStr(x); if (s !== undefined) out.push(s); }
      return out;
    }
    case "ns": {
      if (!Array.isArray(v)) return undefined;
      /** @type {number[]} */
      const out = [];
      for (const x of v) { const n = toNum(x); if (n !== undefined) out.push(n); }
      return out;
    }
    default: return undefined;
  }
}

/**
 * Keep only props and style options the type declares, coerced to their kind.
 * @param {string} type @param {Record<string, unknown>} props
 * @returns {{ props: Record<string, string|number|boolean|string[]|number[]>, dropped: string[] }}
 */
export function normalizeProps(type, props) {
  /** @type {Record<string, string|number|boolean|string[]|number[]>} */
  const out = {};
  /** @type {string[]} */
  const dropped = [];
  const entry = Object.hasOwn(CATALOG, type) ? CATALOG[type] : undefined;
  for (const key of Object.keys(props ?? {})) {
    /** @type {PropKind|undefined} */
    let kind;
    if (entry) {
      if (Object.hasOwn(entry.props, key)) kind = entry.props[key];
      else if (key === "region" && type !== "App" && type !== "Screen") kind = "s";
      else if (entry.styles.includes(key) && Object.hasOwn(STYLE_OPTIONS, key)) kind = STYLE_OPTIONS[/** @type {keyof typeof STYLE_OPTIONS} */ (key)];
    }
    const v = kind === undefined ? undefined : coerce(kind, props[key]);
    if (v === undefined) dropped.push(key);
    else Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return { props: out, dropped };
}

const TONE_WORDS = {
  success: ["approved", "paid", "done", "active", "complete", "success", "live"],
  warning: ["pending", "waiting", "draft", "review", "scheduled"],
  danger: ["failed", "overdue", "rejected", "cancelled", "blocked", "error"],
};

/** @param {string} word @returns {"success"|"warning"|"danger"|"default"} */
export function pillTone(word) {
  const w = String(word).trim().toLowerCase();
  if (TONE_WORDS.success.includes(w)) return "success";
  if (TONE_WORDS.warning.includes(w)) return "warning";
  if (TONE_WORDS.danger.includes(w)) return "danger";
  return "default";
}

/**
 * Split a compact row on "|". "@x" is a person, "#x" a pill. Empty cells are dropped, or kept as empty
 * text with `keepEmpty` (a table row, whose cells must stay under their columns).
 * @param {string} row
 * @param {{ keepEmpty?: boolean }} [options]
 * @returns {{ kind: "text"|"person"|"pill"; text: string; tone?: string }[]}
 */
export function parseCells(row, { keepEmpty = false } = {}) {
  /** @type {{ kind: "text"|"person"|"pill"; text: string; tone?: string }[]} */
  const out = [];
  for (const raw of String(row ?? "").split("|")) {
    const c = raw.trim();
    if (!c && !keepEmpty) continue;
    if (c.startsWith("@") && c.length > 1) out.push({ kind: "person", text: c.slice(1).trim() });
    else if (c.startsWith("#") && c.length > 1) { const text = c.slice(1).trim(); out.push({ kind: "pill", text, tone: pillTone(text) }); }
    else out.push({ kind: "text", text: c });
  }
  return out;
}
