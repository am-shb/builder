// Motion with meaning for the keyed reconcile: added nodes grow in, removed nodes collapse,
// nodes whose layout shifted glide there (FLIP), prop edits cross-fade, a screen change
// slides, and a draft that becomes agreed gets a short "settled" outline morph. A re-theme fades
// a copy of the old canvas out over the new one; an agreed theme gets a settle frame round the canvas.
// Only transform and opacity animate; every animation is stepped by the shared 15 fps clock.
import { animate, logMotion, now } from "@renderer/clock.js";

export const ENTER_MS = 350;
export const GLIDE_MS = 350;
export const EXIT_MS = 300;
export const FADE_MS = 250;
export const SCREEN_MS = 450;
export const SETTLE_MS = 400;
const SETTLE_HOLD_MS = 700;
export const THEME_FADE_MS = 450;
const MAX_FADE_CLONE = 150; // descendants; bigger subtrees skip the cross-fade copy
const MAX_THEME_CLONE = 3000; // elements; a bigger canvas re-themes without the fade
const EASE = "ease-out";

const flips = new WeakMap(); // element -> its in-flight glide
let screenSettlesAt = 0;

const isEmpty = (r) => !r || (r.width === 0 && r.height === 0);
const whenDone = (a, fn) => a.finished.then(fn, fn);

/** The positioned container renderTree draws into (class m-root). */
export function rootOf(el) {
  const root = el && el.closest ? el.closest(".m-root") : null;
  if (root && !root.dataset.mPositioned) {
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    root.dataset.mPositioned = "1";
  }
  return root;
}

/** Layout box in the root's content coordinates, ignoring transforms (so mid-animation reads are stable). */
export function layoutBox(el, root) {
  if (!el.offsetParent) return null; // display:none somewhere up the tree
  let x = 0;
  let y = 0;
  let e = el;
  while (e && e !== root) {
    x += e.offsetLeft;
    y += e.offsetTop;
    const p = e.offsetParent;
    if (p && p !== root) {
      x += p.clientLeft;
      y += p.clientTop;
    }
    e = p;
  }
  if (e !== root) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** How far above `el` its draft tag reaches (theme.css), or 0 when it shows none. */
export function tagAbove(el) {
  const tag = getComputedStyle(el, "::after");
  if (tag.content === "none" || tag.content === "normal") return 0;
  return Math.max(0, -(parseFloat(tag.top) || 0));
}

/** Overlay layer (content coordinates of the root) for settle outlines. */
export function motionLayer(root) {
  let layer = root.querySelector(":scope > .m-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "m-layer";
    root.append(layer);
  }
  return layer;
}

export function captureRects(map) {
  const rects = new Map();
  for (const [id, el] of map) rects.set(id, el.getBoundingClientRect());
  return rects;
}

/** A static copy of an element about to change, for the cross-fade; null when too big to copy. */
export function cloneForCrossFade(el) {
  return el.getElementsByTagName("*").length > MAX_FADE_CLONE ? null : el.cloneNode(true);
}

// Ghosts are out-of-flow copies (or removed elements) kept at their old spot while they fade.
// They sit at the tail of their parent, after every live child, so keyed placement is unaffected.
function prepareGhost(ghost, rect) {
  for (const n of [ghost, ...ghost.querySelectorAll("[data-node-id]")]) n.removeAttribute("data-node-id");
  ghost.classList.add("m-ghost");
  ghost.hidden = false;
  Object.assign(ghost.style, {
    position: "absolute", left: "0px", top: "0px", margin: "0px", pointerEvents: "none",
    width: `${rect.width}px`, height: `${rect.height}px`,
  });
}

// `origin` is the ghost's on-screen rect at left/top 0 (it already includes any ancestor glide).
function positionGhost(ghost, rect, origin) {
  ghost.style.left = `${rect.left - origin.left}px`;
  ghost.style.top = `${rect.top - origin.top}px`;
}

/** Fades an element out where it stands, out of flow, then removes it. */
export function fadeOutInPlace(el, ms = EXIT_MS) {
  const rect = el.getBoundingClientRect();
  if (isEmpty(rect)) return void el.remove();
  prepareGhost(el, rect);
  positionGhost(el, rect, el.getBoundingClientRect());
  whenDone(animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: EASE }), () => el.remove());
}

export function screenTransitionEndsAt() {
  return screenSettlesAt;
}

/** Slides from one Screen to another: the old one (as a copy) leaves, the new one arrives. */
export function transitionScreen(fromEl, toEl) {
  const parent = toEl.parentElement;
  const screens = [...parent.children].filter((c) => c.dataset.type === "Screen" && !c.classList.contains("m-ghost"));
  const dir = screens.indexOf(toEl) >= screens.indexOf(fromEl) ? 1 : -1;
  const to = toEl.getBoundingClientRect();
  const ghost = fromEl.cloneNode(true);
  prepareGhost(ghost, { width: to.width, height: fromEl.offsetHeight || to.height });
  ghost.style.height = "auto";
  parent.append(ghost);
  positionGhost(ghost, to, ghost.getBoundingClientRect());
  const d = Math.round(to.width * 0.25) * dir;
  whenDone(animate(ghost, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-d}px)` }], { duration: SCREEN_MS, easing: EASE }), () => ghost.remove());
  animate(toEl, [{ opacity: 0, transform: `translateX(${d}px)` }, { opacity: 1, transform: "none" }], { duration: SCREEN_MS, easing: EASE });
  screenSettlesAt = now() + SCREEN_MS;
  logMotion({ fn: "transitionScreen", from: fromEl.dataset.nodeId, to: toEl.dataset.nodeId });
}

/** Draft -> agreed: the dashed outline morphs into a solid one, which then fades (agreed has no outline). */
export function playSettled(el) {
  if (el.dataset.type === "App" || el.dataset.type === "Screen") return; // containers draw no draft outline
  const root = rootOf(el);
  const box = root && layoutBox(el, root);
  if (!box) return;
  const off = 6; // matches the draft outline: 3px wide at 3px offset
  const frame = document.createElement("div");
  frame.className = "m-settle";
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  Object.assign(frame.style, {
    left: `${box.x - off}px`, top: `${box.y - off}px`, width: `${box.w + off * 2}px`, height: `${box.h + off * 2}px`,
    borderRadius: `${radius + off}px`,
  });
  const dashed = document.createElement("div");
  dashed.className = "m-settle-dashed";
  const solid = document.createElement("div");
  solid.className = "m-settle-solid";
  frame.append(dashed, solid);
  motionLayer(root).append(frame);
  animate(dashed, [{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, easing: EASE });
  animate(solid, [{ opacity: 0, transform: "scale(1.03)" }, { opacity: 1, transform: "none" }], { duration: SETTLE_MS, easing: EASE });
  const out = animate(solid, [{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, delay: SETTLE_MS + SETTLE_HOLD_MS, easing: EASE });
  whenDone(out, () => frame.remove());
  logMotion({ fn: "playSettled", id: el.dataset.nodeId });
}

// Whole-canvas layers: in the container's content coordinates, so they line up with what it shows.
function canvasRoot(container) {
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  return container;
}

/** A static copy of the canvas content as it looks now, for the theme fade; null when too big to copy. */
export function snapshotCanvas(container) {
  const content = [...container.children].filter((c) => c.dataset.nodeId);
  if (!content.length) return null;
  if (content.reduce((n, c) => n + 1 + c.getElementsByTagName("*").length, 0) > MAX_THEME_CLONE) return null;
  const snap = document.createElement("div");
  snap.className = "m-theme-fade";
  for (const c of content) snap.append(c.cloneNode(true));
  // A copy must never be found as the node it shows (focus, lookups, interactions).
  for (const n of snap.querySelectorAll("[data-node-id]")) n.removeAttribute("data-node-id");
  snap.inert = true;
  return snap;
}

/** Lays the old canvas (from snapshotCanvas) over the re-themed one and fades it out. */
export function playThemeFade(container, snapshot) {
  const root = canvasRoot(container);
  // A set height, so the copied App's min-height: 100% fills the canvas as the live one does: on a short
  // screen the area below the content must fade too, not switch to the new background at once.
  Object.assign(snapshot.style, {
    left: "0px", top: "0px", width: `${root.clientWidth}px`, height: `${Math.max(root.scrollHeight, root.clientHeight)}px`,
  });
  root.append(snapshot);
  whenDone(animate(snapshot, [{ opacity: 1 }, { opacity: 0 }], { duration: THEME_FADE_MS, easing: EASE }), () => snapshot.remove());
  logMotion({ fn: "playThemeFade" });
}

/** A theme agreed: a solid frame settles around the whole canvas, then fades (same timing as playSettled). */
export function playThemeSettled(container) {
  const root = canvasRoot(container);
  const frame = document.createElement("div");
  frame.className = "m-theme-settle";
  Object.assign(frame.style, {
    left: `${root.scrollLeft}px`, top: `${root.scrollTop}px`, width: `${root.clientWidth}px`, height: `${root.clientHeight}px`,
  });
  root.append(frame);
  animate(frame, [{ opacity: 0, transform: "scale(1.02)" }, { opacity: 1, transform: "none" }], { duration: SETTLE_MS, easing: EASE });
  const out = animate(frame, [{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, delay: SETTLE_MS + SETTLE_HOLD_MS, easing: EASE });
  whenDone(out, () => frame.remove());
  logMotion({ fn: "playThemeSettled" });
}

function visibleScreen(entries, rects) {
  for (const [id, el] of entries) {
    if (el.dataset.type !== "Screen") continue;
    if (rects ? !isEmpty(rects.get(id)) : !el.hidden && el.getClientRects().length > 0) return el;
  }
  return null;
}

/**
 * Animates the difference between the DOM before a reconcile (prevRects, from captureRects) and
 * after it (map). `removed` holds elements reconcile dropped (still in the DOM; motion removes them);
 * `previous` holds, per updated id, { wasDraft, clone } captured just before the update.
 */
export function animateReconcile(prevRects, map, changes, { removed = new Map(), previous = new Map() } = {}) {
  const first = map.values().next().value;
  const root = rootOf(first);
  if (!root) {
    for (const el of removed.values()) el.remove();
    return;
  }
  const updated = new Set(changes.filter((c) => c.kind === "updated").map((c) => c.id));

  // 1. Screen change: slide, and let nodes removed from the old screen leave with it.
  const from = visibleScreen([...map, ...removed], prevRects);
  const to = visibleScreen(map, null);
  let incoming = null;
  if (from && to && from !== to) {
    for (const [id, el] of removed) {
      if (from === el || from.contains(el)) {
        el.remove();
        removed.delete(id);
      }
    }
    transitionScreen(from, to);
    incoming = to;
  }

  // 2. Exits: only the topmost removed element of a removed subtree becomes a ghost.
  const removedEls = new Set(removed.values());
  const ghosts = [];
  for (const [id, el] of removed) {
    let anc = el.parentElement;
    while (anc && !removedEls.has(anc)) anc = anc.parentElement;
    if (anc) continue; // leaves inside its removed ancestor
    const rect = prevRects.get(id);
    if (isEmpty(rect) || !el.isConnected) el.remove();
    else ghosts.push({ el, rect, exit: true });
  }

  // 3. Cross-fade copies of updated nodes, and drafts that just became agreed.
  const settled = [];
  for (const [id, p] of previous) {
    const el = map.get(id);
    if (!el || !el.isConnected) continue;
    const rect = prevRects.get(id);
    if (p.clone && updated.has(id) && !isEmpty(rect)) {
      el.parentElement.append(p.clone);
      ghosts.push({ el: p.clone, rect, exit: false });
    }
    if (p.wasDraft && !el.classList.contains("is-draft")) settled.push(el);
  }
  for (const g of ghosts) prepareGhost(g.el, g.rect);

  // 4. Measure the new layout once and work out glides and entries.
  const rr = root.getBoundingClientRect();
  const ox = rr.left + root.clientLeft - root.scrollLeft;
  const oy = rr.top + root.clientTop - root.scrollTop;
  const ZERO = { x: 0, y: 0 };
  const offsets = new Map(); // element -> where it visually sits now relative to its new layout
  const entering = new Set();
  const glides = [];
  const enters = [];
  for (const [id, el] of map) {
    const parent = el.parentElement && el.parentElement.closest("[data-node-id]");
    const inherited = (parent && offsets.get(parent)) || ZERO;
    offsets.set(el, inherited);
    const box = layoutBox(el, root);
    if (!box || (box.w === 0 && box.h === 0)) continue;
    const prev = prevRects.get(id);
    if (!prev) {
      if (parent && entering.has(parent)) entering.add(el); // grows in with its parent
      else if (!incoming || !incoming.contains(el)) {
        entering.add(el);
        enters.push(el);
      }
      continue;
    }
    if (isEmpty(prev)) continue; // was hidden: nothing to glide from
    const own = { x: prev.left - (ox + box.x), y: prev.top - (oy + box.y) };
    offsets.set(el, own);
    const dx = own.x - inherited.x;
    const dy = own.y - inherited.y;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) glides.push({ el, dx, dy });
  }

  // 5. Start everything (writes only from here on, except one read for ghost origins).
  for (const { el, dx, dy } of glides) {
    flips.get(el)?.cancel();
    flips.set(el, animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: EASE }));
  }
  for (const el of enters) {
    animate(el, [{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: ENTER_MS, easing: EASE });
  }
  const origins = ghosts.map((g) => g.el.getBoundingClientRect());
  ghosts.forEach((g, i) => {
    positionGhost(g.el, g.rect, origins[i]);
    const a = g.exit
      ? animate(g.el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.94, 0.4)" }], { duration: EXIT_MS, easing: EASE })
      : animate(g.el, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE });
    whenDone(a, () => g.el.remove());
  });
  for (const el of settled) playSettled(el);
  logMotion({ fn: "animateReconcile", glides: glides.length, enters: enters.length, ghosts: ghosts.length, settled: settled.length });
}
