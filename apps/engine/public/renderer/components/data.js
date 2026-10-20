// Showing data: stats, tables, feeds, charts and boards. Compact list props are parsed with parseCells and the
// inner DOM is rebuilt only when the props it shows change.
import {
  h, str, arr, nums, clampInt, setText, setHidden, setOptional, setVariant, withParts, syncTexts, changed,
  cells, cellEl, avatar, syncAvatar, isAmount, syncIcon,
} from "@renderer/components/dom.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** A panel with an optional title line above its content. */
function titled(cls) {
  const el = h("div", `${cls} b-panel`);
  const title = h("div", "b-panel-title");
  const body = h("div", `${cls}-body`);
  el.append(title, body);
  return withParts(el, { title, body });
}

const TREND_ARROW = { up: "▲", down: "▼", flat: "–" };
const TREND_TONE = { up: "success", down: "danger", flat: "default" };

function statCard() {
  return {
    create() {
      const el = h("div", "b-stat b-panel");
      const label = h("div", "b-stat-label");
      const value = h("div", "b-stat-value");
      const delta = h("span", "b-pill b-stat-delta");
      const icon = h("span", "b-stat-icon");
      el.append(icon, label, value, delta);
      return withParts(el, { icon, label, value, delta });
    },
    update(el, node) {
      const p = node.props;
      syncIcon(el.parts.icon, p.icon, 24);
      setText(el.parts.label, str(p.label));
      setText(el.parts.value, str(p.value));
      const trend = Object.hasOwn(TREND_ARROW, str(p.trend)) ? str(p.trend) : "";
      const delta = str(p.delta);
      setOptional(el.parts.delta, delta && trend ? `${TREND_ARROW[trend]} ${delta}` : delta);
      // The card's own tone wins over the trend's color (rising spend can be bad news).
      const tone = p.tone && p.tone !== "default" ? str(p.tone) : TREND_TONE[trend] ?? "default";
      setVariant(el.parts.delta, "is-tone-", tone);
    },
  };
}

function table() {
  return {
    create() {
      const el = h("div", "b-table b-panel");
      const t = h("table", "b-table-grid");
      const head = h("thead");
      const body = h("tbody");
      t.append(head, body);
      el.append(t);
      return withParts(el, { head, body });
    },
    update(el, node) {
      const cols = arr(node.props.columns);
      // Blank cells are kept, so the cells after one stay under their own columns.
      const rows = arr(node.props.rows).map((r) => cells(r, { keepEmpty: true }));
      if (!changed(el, JSON.stringify([cols, rows]))) return;
      const width = cols.length || Math.max(1, ...rows.map((r) => r.length));
      // A row with more cells than columns keeps the extras in its last cell.
      const fit = (r) => (r.length > width ? [...r.slice(0, width - 1).map((c) => [c]), r.slice(width - 1)] : r.map((c) => [c]));
      const fitted = rows.map(fit);
      const filled = (cs) => !!cs && cs.some((c) => c.text !== "");
      const numeric = Array.from({ length: width }, (_, i) =>
        fitted.some((r) => filled(r[i])) && fitted.every((r) => !filled(r[i]) || r[i].every((c) => c.kind === "text" && (c.text === "" || isAmount(c.text)))));
      const tr = h("tr");
      cols.forEach((c, i) => tr.append(h("th", numeric[i] ? "is-num" : "", c)));
      el.parts.head.replaceChildren(...(cols.length ? [tr] : []));
      el.parts.body.replaceChildren(...fitted.map((r) => {
        const row = h("tr");
        for (let i = 0; i < width; i++) {
          const td = h("td", numeric[i] ? "is-num" : "");
          if (r[i]) td.append(...r[i].filter((c) => c.text !== "").map(cellEl));
          row.append(td);
        }
        return row;
      }));
    },
  };
}

/** "@Name | subtitle | trailing…": who on the left, everything after the subtitle on the right. */
function activityRow(row) {
  const cs = cells(row);
  const el = h("div", "b-activity-row");
  const lead = cs.shift();
  const who = h("div", "b-activity-who");
  if (lead) {
    if (lead.kind === "person") el.append(avatar(lead.text));
    who.append(lead.kind === "pill" ? cellEl(lead) : h("span", "b-activity-name", lead.text));
  }
  const sub = cs[0]?.kind === "text" ? cs.shift() : undefined;
  if (sub) who.append(h("span", "b-activity-sub", sub.text));
  el.append(who);
  for (const c of cs) el.append(cellEl(c));
  return el;
}

function activityList() {
  return {
    create: () => titled("b-activity"),
    update(el, node) {
      setOptional(el.parts.title, str(node.props.title));
      const items = arr(node.props.items);
      if (!changed(el, JSON.stringify(items))) return;
      el.parts.body.replaceChildren(...items.map(activityRow));
    },
  };
}

function emptyChart() {
  return h("div", "b-chart-empty", "No data yet");
}

function barChart(data, labels) {
  const max = Math.max(...data, 0) || 1;
  const bars = h("div", "b-chart-bars");
  const axis = h("div", "b-chart-axis");
  data.forEach((v, i) => {
    const bar = h("span", i === data.length - 1 ? "b-chart-bar is-hi" : "b-chart-bar");
    bar.style.height = `${Math.max(2, (Math.max(0, v) / max) * 100)}%`;
    bars.append(bar);
    axis.append(h("span", "b-chart-tick", labels[i] ?? ""));
  });
  const el = h("div", "b-chart-plot is-bar");
  el.append(bars);
  if (labels.length) el.append(axis);
  return el;
}

function lineChart(data, labels) {
  const lo = Math.min(...data, 0);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const n = data.length;
  // Points sit at the centre of equal slots, so the axis labels below line up with them.
  const pts = data.map((v, i) => [((i + 0.5) / n) * 100, 8 + (1 - (v - lo) / span) * 84]);
  const area = h("div", "b-chart-area");
  const s = svg("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none", class: "b-chart-svg" });
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  s.append(
    svg("polygon", { points: `${pts[0][0].toFixed(2)},100 ${line} ${pts[n - 1][0].toFixed(2)},100`, class: "b-chart-fill" }),
    svg("polyline", { points: line, class: "b-chart-line", "vector-effect": "non-scaling-stroke" }),
  );
  const [lx, ly] = pts[pts.length - 1];
  const dot = h("span", "b-chart-dot");
  dot.style.left = `${lx}%`;
  dot.style.top = `${ly}%`;
  area.append(s, dot);
  const el = h("div", "b-chart-plot is-line");
  el.append(area);
  if (labels.length) {
    const axis = h("div", "b-chart-axis");
    for (let i = 0; i < n; i++) axis.append(h("span", "b-chart-tick", labels[i] ?? ""));
    el.append(axis);
  }
  return el;
}

const DONUT_SLICES = 5; // theme.css colors .is-s0 … .is-s4

function donutChart(data, labels) {
  const vals = data.map((v) => Math.max(0, v));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return emptyChart();
  const r = 15.915; // circumference 100, so dash lengths are percentages
  const s = svg("svg", { viewBox: "0 0 42 42", class: "b-donut" });
  s.append(svg("circle", { cx: 21, cy: 21, r, class: "b-donut-track" }));
  const legend = h("div", "b-donut-legend");
  let at = 0;
  vals.forEach((v, i) => {
    const pct = (v / total) * 100;
    const tone = `is-s${i % DONUT_SLICES}`;
    if (pct > 0) {
      s.append(svg("circle", {
        cx: 21, cy: 21, r, class: `b-donut-slice ${tone}`,
        "stroke-dasharray": `${pct.toFixed(3)} ${(100 - pct).toFixed(3)}`, "stroke-dashoffset": (25 - at).toFixed(3),
      }));
    }
    at += pct;
    const item = h("div", "b-donut-item");
    item.append(h("span", `b-donut-key ${tone}`), h("span", "b-donut-label", labels[i] ?? ""), h("span", "b-donut-pct", `${Math.round(pct)}%`));
    legend.append(item);
  });
  const ring = h("div", "b-donut-ring");
  ring.append(s);
  const el = h("div", "b-chart-plot is-donut");
  el.append(ring, legend);
  return el;
}

function chartCard() {
  return {
    create: () => titled("b-chartcard"),
    update(el, node) {
      setOptional(el.parts.title, str(node.props.title));
      const kind = ["bar", "line", "donut"].includes(str(node.props.kind)) ? str(node.props.kind) : "bar";
      const data = nums(node.props.data);
      const labels = arr(node.props.labels);
      if (!changed(el, JSON.stringify([kind, data, labels]))) return;
      const plot = !data.length ? emptyChart()
        : kind === "line" ? lineChart(data, labels)
        : kind === "donut" ? donutChart(data, labels)
        : barChart(data, labels);
      el.parts.body.replaceChildren(plot);
    },
  };
}

function progress() {
  return {
    create() {
      const el = h("div", "b-progress");
      const top = h("div", "b-progress-top");
      const label = h("span", "b-progress-label");
      const value = h("span", "b-progress-value");
      top.append(label, value);
      const track = h("div", "b-progress-track");
      const fill = h("span", "b-progress-fill");
      track.append(fill);
      el.append(top, track);
      return withParts(el, { label, value, fill });
    },
    update(el, node) {
      const v = clampInt(node.props.value, 0, 100, 0);
      setText(el.parts.label, str(node.props.label));
      setText(el.parts.value, `${v}%`);
      const w = `${v}%`;
      if (el.parts.fill.style.width !== w) el.parts.fill.style.width = w;
    },
  };
}

/** "time | title | note" */
function timeline() {
  return {
    create: () => h("div", "b-timeline b-panel"),
    update(el, node) {
      const items = arr(node.props.items);
      if (!changed(el, JSON.stringify(items))) return;
      el.replaceChildren(...items.map((row) => {
        const cs = cells(row);
        const item = h("div", "b-timeline-item");
        const dot = h("span", "b-timeline-dot");
        const body = h("div", "b-timeline-body");
        const [time, title, ...rest] = cs;
        if (time) body.append(h("span", "b-timeline-time", time.text));
        if (title) body.append(title.kind === "text" ? h("span", "b-timeline-title", title.text) : cellEl(title));
        if (rest.length) {
          const note = h("div", "b-timeline-note");
          note.append(...rest.map(cellEl));
          body.append(note);
        }
        item.append(dot, body);
        return item;
      }));
    },
  };
}

/** Days like "Mon 14": the word above, the date below. */
function calendarStrip() {
  return {
    create: () => h("div", "b-calendar b-panel"),
    update(el, node) {
      const days = arr(node.props.days);
      const active = clampInt(node.props.active, 0, Math.max(0, days.length - 1), 0);
      if (!changed(el, JSON.stringify([days, active]))) return;
      el.replaceChildren(...days.map((d, i) => {
        const day = h("div", i === active ? "b-day is-active" : "b-day");
        const m = d.trim().match(/^(\S+)\s+(.+)$/);
        if (m) day.append(h("span", "b-day-name", m[1]), h("span", "b-day-num", m[2]));
        else day.append(h("span", "b-day-num", d));
        return day;
      }));
    },
  };
}

/** Cards are "column | title | @person"; a card naming an unknown column goes in the first one. */
function kanban() {
  return {
    create: () => h("div", "b-kanban"),
    update(el, node) {
      const columns = arr(node.props.columns);
      const cards = arr(node.props.cards);
      if (!changed(el, JSON.stringify([columns, cards]))) return;
      const names = columns.length ? columns : ["To do"];
      const lanes = names.map((name) => ({ name, cards: [] }));
      for (const row of cards) {
        const [col, ...rest] = cells(row);
        if (!col) continue;
        const i = names.findIndex((n) => n.trim().toLowerCase() === col.text.trim().toLowerCase());
        lanes[i < 0 ? 0 : i].cards.push(i < 0 ? [col, ...rest] : rest);
      }
      el.replaceChildren(...lanes.map((lane) => {
        const col = h("div", "b-lane");
        const hd = h("div", "b-lane-head");
        hd.append(h("span", "b-lane-name", lane.name), h("span", "b-lane-count", String(lane.cards.length)));
        col.append(hd);
        for (const cs of lane.cards) {
          const card = h("div", "b-lane-card");
          const [title, ...rest] = cs;
          if (title) card.append(title.kind === "text" ? h("div", "b-lane-title", title.text) : cellEl(title));
          if (rest.length) {
            const meta = h("div", "b-lane-meta");
            meta.append(...rest.map(cellEl));
            card.append(meta);
          }
          col.append(card);
        }
        return col;
      }));
    },
  };
}

export const DATA = {
  StatCard: statCard(),
  Table: table(),
  ActivityList: activityList(),
  ChartCard: chartCard(),
  Progress: progress(),
  Timeline: timeline(),
  CalendarStrip: calendarStrip(),
  Kanban: kanban(),

  List: {
    create() {
      const el = h("div", "b-list b-panel");
      el.setAttribute("role", "list");
      const items = h("div", "b-list-items");
      const added = h("div", "b-list-added");
      el.append(items, added);
      return withParts(el, { items, added });
    },
    update(el, node, ui) {
      // Items appended by an interaction (ui.lists) show after the node children.
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
      const av = h("span", "b-av");
      av.setAttribute("aria-hidden", "true");
      const icon = h("span", "b-listitem-icon");
      const main = h("span", "b-listitem-main");
      const text = h("span", "b-listitem-text");
      const subtitle = h("span", "b-listitem-sub");
      main.append(text, subtitle);
      const meta = h("span", "b-listitem-meta");
      const body = h("span", "b-listitem-body");
      el.append(av, icon, main, meta, body);
      return withParts(el, { av, icon, text, subtitle, meta, body });
    },
    update(el, node) {
      const p = node.props;
      const name = str(p.avatar);
      setHidden(el.parts.av, !name);
      if (name) syncAvatar(el.parts.av, name);
      syncIcon(el.parts.icon, p.icon);
      setText(el.parts.text, str(p.text));
      setOptional(el.parts.subtitle, str(p.subtitle));
      setOptional(el.parts.meta, str(p.meta));
    },
    slot: (el) => el.parts.body,
  },
};

