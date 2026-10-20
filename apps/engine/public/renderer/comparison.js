// The comparison view (spec 9, 10a): when the room disagrees, its 2-3 options side by side across
// the whole 1280x720 frame. Each option is a scaled live preview labelled A/B/C, with its one-line
// tradeoff, who backs it, and rings on the part that differs. It opens with a split; on resolve
// the winner expands into the prototype area and the others fold away. Only transform and opacity
// animate, all stepped by the shared 15 fps clock; everything else is painted once.
import { animate, logMotion } from "@renderer/clock.js";
import { renderTree, initialUiState } from "@renderer/render.js";
import { layoutBox, tagAbove, scrollerOf, scrollWithin } from "@renderer/motion.js";

export const SPLIT_MS = 450;
export const EXPAND_MS = 500;
// "Show option B": how long the other options stay dimmed while B is ringed, and how dim they get.
export const FOCUS_OPTION_MS = 3000;
const FOCUS_DIM = 0.4;
const FOLD_MS = 350;
const FADE_MS = 300;
const DISSOLVE_MS = 250;
const EASE = "ease-out";
// Where the winner lands: the stage's prototype area (left 900x720).
const PROTO_AREA = { x: 0, y: 0, w: 900, h: 720 };
const SPREAD = 0.25; // the split starts the options this far back toward the prototype area's centre
// Previews lay the prototype out narrower than the stage's 900 px and scale it down, so its 22 px
// body text still shows at ~15-16 px.
const SCALE = { 2: 0.72, 3: 0.66 };
const RING_PAD = 9; // clears a draft node's dashed outline
const MAX_RINGS = 3;

// container -> { key, view, el, blank, bg, top, options: [{ label, el, card, head, preview, marks, scale }], focus?: Animation[] }
const shown = new WeakMap();

function div(cls, text) {
  const e = document.createElement("div");
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const finished = (a) => a.finished.then(() => {}, () => {});

/** "Sara", "Amir and Ada", "Lee, Bo and Ada". */
function names(list) {
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function hint(labels) {
  const q = labels.map((l) => `“${l}”`);
  return `Say ${q.length < 2 ? q.join("") : `${q.slice(0, -1).join(", ")} or ${q[q.length - 1]}`} to choose`;
}

// The Screen holding node `id` (null when not found).
function screenOf(proto, id) {
  const walk = (n, screen) => {
    const s = n.type === "Screen" ? n.id : screen;
    if (n.id === id) return s;
    for (const c of n.children) {
      const r = walk(c, s);
      if (r) return r;
    }
    return null;
  };
  return walk(proto.root, null);
}

function buildOption(variant) {
  const el = div("c-option");
  el.dataset.label = variant.label;
  const card = div("c-card");
  const head = div("c-head");
  const text = div("c-text");
  const backers = div("c-backers");
  if (variant.backers.length) {
    const who = document.createElement("b");
    who.textContent = names(variant.backers);
    backers.append("Backed by ", who);
  }
  text.append(div("c-summary", variant.summary), backers);
  head.append(div("c-label", variant.label), text);
  const preview = div("c-preview");
  const frame = div("c-frame");
  const marks = div("c-marks");
  preview.append(frame, marks);
  el.append(card, head, preview);
  return { label: variant.label, el, card, head, preview, frame, marks };
}

// Renders the variant into its preview (on the screen its change lands on), scrolls the change
// into view, dims the rest a little and rings each changed region.
function fillPreview(o, variant, scale) {
  const pw = o.preview.clientWidth;
  const ph = o.preview.clientHeight;
  const vw = Math.round(pw / scale);
  const vh = Math.round(ph / scale);
  Object.assign(o.frame.style, { width: `${vw}px`, height: `${vh}px` });
  const screen = (variant.focusIds.length && screenOf(variant.proto, variant.focusIds[0])) || variant.proto.currentScreen;
  const nodes = renderTree(o.frame, variant.proto, { ...initialUiState(variant.proto), screen });

  const els = variant.focusIds.map((id) => nodes.get(id)).filter((el) => el && el.getClientRects().length > 0);
  const top = els.filter((el) => !els.some((p) => p !== el && p.contains(el))).slice(0, MAX_RINGS);
  // A change below the phone's fold: scroll the phone's screen area to it first (the boxes below are then
  // measured where they show).
  const scroller = top.length ? scrollerOf(top[0], o.frame) : null;
  const first = scroller && layoutBox(top[0], o.frame);
  if (first) scrollWithin(scroller, o.frame, { ...first, y: first.y - tagAbove(top[0]) });
  const boxes = top.map((el) => {
    const b = layoutBox(el, o.frame);
    const tag = tagAbove(el); // the ring clears a draft node's tag too
    return b && { id: el.dataset.nodeId, x: b.x, y: b.y - tag, w: b.w, h: b.h + tag };
  }).filter(Boolean);

  // Scroll (in the preview's own units) just far enough to bring the first change into view. The frame
  // scrolls (it clips its overflow), so the app frame's sticky sidebar or top bar stays in view.
  let offset = 0;
  if (boxes.length) {
    const first = boxes[0];
    const content = o.frame.firstElementChild ? o.frame.firstElementChild.offsetHeight : vh;
    offset = Math.max(0, Math.min(first.y + first.h + 16 - vh, first.y - 24, content - vh));
  }
  o.frame.style.transform = `scale(${scale})`;
  o.frame.scrollTop = offset;
  offset = o.frame.scrollTop;

  const rect = (b) => ({
    x: b.x * scale - RING_PAD, y: (b.y - offset) * scale - RING_PAD, w: b.w * scale + RING_PAD * 2, h: b.h * scale + RING_PAD * 2,
  });
  const place = (e, r) => Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  if (boxes.length) {
    const rs = boxes.map(rect);
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    const hole = div("c-hole");
    place(hole, { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y });
    o.marks.append(hole);
    rs.forEach((r, i) => {
      const ring = div("c-ring");
      ring.dataset.focusId = boxes[i].id;
      place(ring, r);
      o.marks.append(ring);
    });
  }
  o.scale = scale;
}

function build(container, view) {
  const el = div("c-view");
  // Under the dark background, a blank prototype area: on resolve it hides the real prototype
  // (already merged) while the winner flies in, then dissolves with it.
  const blank = div("c-blank");
  Object.assign(blank.style, { left: `${PROTO_AREA.x}px`, top: `${PROTO_AREA.y}px`, width: `${PROTO_AREA.w}px`, height: `${PROTO_AREA.h}px` });
  const bg = div("c-bg");
  const top = div("c-top");
  top.append(div("c-topic", view.topic), div("c-hint", hint(view.variants.map((v) => v.label))));
  const row = div("c-options");
  const options = view.variants.map(buildOption);
  row.append(...options.map((o) => o.el));
  el.append(blank, bg, top, row);
  // A view still on its way out goes now; cancelling its animations lets its exit promise settle.
  for (const a of container.getAnimations({ subtree: true })) a.cancel();
  container.replaceChildren(el);
  const scale = SCALE[options.length] ?? SCALE[3];
  options.forEach((o, i) => fillPreview(o, view.variants[i], scale));
  return { el, blank, bg, top, options };
}

function remove(container, st) {
  if (st.el.parentNode === container) st.el.remove();
}

// Settles every running animation of the view, so its rects are its layout again.
function settle(st) {
  for (const a of st.el.getAnimations({ subtree: true })) a.finish();
}

const fadeOut = (el, ms) => animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE, fill: "forwards" });
const fold = (el) => animate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.94, 0.4)" }], { duration: FOLD_MS, easing: EASE, fill: "forwards" });

/**
 * Shows `view` ({ conflictId, topic, variants }) in `container`, which spans the frame, with a
 * 450 ms split: the options spread out from the prototype area into their columns. The same view
 * again is a no-op; null clears it (the options fold away) and returns a promise for the exit.
 */
export function showComparison(container, view) {
  const st = shown.get(container);
  if (!view) {
    if (!st) return Promise.resolve();
    shown.delete(container);
    settle(st);
    const exits = [...st.options.map((o) => fold(o.el)), fadeOut(st.top, FADE_MS), fadeOut(st.bg, FOLD_MS)];
    logMotion({ fn: "closeComparison", conflictId: st.view.conflictId });
    return Promise.all(exits.map(finished)).then(() => remove(container, st));
  }
  const key = JSON.stringify(view);
  if (st && st.key === key) return Promise.resolve();
  if (st) remove(container, st);

  const next = { key, view, ...build(container, view) };
  shown.set(container, next);
  // The background is opaque early, so the options spread out over the dark, not over the prototype.
  animate(next.bg, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }], { duration: SPLIT_MS, easing: EASE });
  animate(next.top, [{ opacity: 0, transform: "translateY(-16px)" }, { opacity: 1, transform: "none" }], { duration: SPLIT_MS, easing: EASE });
  for (const o of next.options) {
    const r = o.el.getBoundingClientRect();
    const dx = Math.round((PROTO_AREA.x + PROTO_AREA.w / 2 - (r.left + r.width / 2)) * SPREAD);
    animate(o.el, [{ opacity: 0, transform: `translateX(${dx}px) scale(0.94)` }, { opacity: 1, transform: "none" }], { duration: SPLIT_MS, easing: EASE });
  }
  logMotion({ fn: "showComparison", conflictId: view.conflictId, options: next.options.length });
  return Promise.resolve();
}

/**
 * The room picked `winnerLabel` for conflict `conflictId`: its preview expands into the prototype
 * area (FLIP, 500 ms) to the size the prototype shows at, then dissolves (250 ms) into the real
 * prototype underneath, which already has the winner merged. The other options fold away.
 * Returns a promise that resolves once the view is gone, or null (and touches nothing) when the
 * comparison shown is not for `conflictId`, e.g. a late resolve for an earlier conflict.
 */
export function resolveComparison(container, conflictId, winnerLabel) {
  const st = shown.get(container);
  if (!st || st.view.conflictId !== conflictId) return null;
  const winner = st.options.find((o) => o.label === winnerLabel);
  if (!winner) return showComparison(container, null); // the winner was not among the options shown
  return expandWinner(container, st, winner);
}

/**
 * "Show option B": for FOCUS_OPTION_MS the other options dim and B is ringed, so the room sees which
 * one is being talked about. Nothing is picked: the room still says which it wants. Returns false,
 * touching nothing, when the comparison shown is not for `conflictId` or has no such option.
 */
export function focusOption(container, conflictId, label) {
  const st = shown.get(container);
  const target = st && st.view.conflictId === conflictId ? st.options.find((o) => o.label === label) : null;
  if (!target) return false;
  for (const a of st.focus ?? []) a.cancel(); // a newer request replaces the one playing
  const hold = (from, to) => [{ opacity: from }, { opacity: to, offset: 0.1 }, { opacity: to, offset: 0.9 }, { opacity: from }];
  const ring = div("c-focus");
  target.el.append(ring);
  const shine = animate(ring, hold(0, 1), { duration: FOCUS_OPTION_MS, easing: EASE });
  finished(shine).then(() => ring.remove());
  st.focus = [
    shine,
    ...st.options.filter((o) => o !== target).map((o) => animate(o.el, hold(1, FOCUS_DIM), { duration: FOCUS_OPTION_MS, easing: EASE })),
  ];
  logMotion({ fn: "focusOption", conflictId, label });
  return true;
}

async function expandWinner(container, st, winner) {
  shown.delete(container);
  settle(st);

  const losers = st.options.filter((o) => o !== winner);
  st.blank.style.opacity = "1"; // behind the opaque background: nothing changes on screen yet
  const r = winner.preview.getBoundingClientRect();
  const k = 1 / winner.scale;
  const expand = animate(winner.preview, [
    { transform: "none" },
    { transform: `translate(${PROTO_AREA.x - r.left}px, ${PROTO_AREA.y - r.top}px) scale(${k})` },
  ], { duration: EXPAND_MS, easing: EASE, fill: "forwards" });
  const others = [
    ...losers.map((o) => fold(o.el)),
    fadeOut(st.top, FADE_MS), fadeOut(winner.card, FADE_MS), fadeOut(winner.head, FADE_MS), fadeOut(winner.marks, FADE_MS),
    fadeOut(st.bg, EXPAND_MS), // the panel and dock come back on the right; the blank shows on the left
  ];
  logMotion({ fn: "resolveComparison", conflictId: st.view.conflictId, winner: winner.label, folded: losers.length });
  await finished(expand);
  if (!st.el.isConnected) return; // a newer comparison replaced this one mid-flight
  await Promise.all([finished(fadeOut(winner.preview, DISSOLVE_MS)), finished(fadeOut(st.blank, DISSOLVE_MS)), ...others.map(finished)]);
  remove(container, st);
}
