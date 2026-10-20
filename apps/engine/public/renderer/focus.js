// Focus moments and responsiveness cues: the spotlight on what changed (one at a time, 1500 ms),
// the shimmering placeholder where a streamed element is coming, and the voice-command pointer.
import { animate, logMotion } from "@renderer/clock.js";
import { rootOf, layoutBox, fadeOutInPlace, tagAbove, scrollerOf, scrollWithin, topInset } from "@renderer/motion.js";
import { slotOf } from "@renderer/components.js";

export const SPOTLIGHT_MS = 1500;
export const DIM = 0.35; // everything outside the ring shows at this strength
const MAX_SPOTLIGHTS_PER_PATCH = 3;
const MAX_PENDING = 3; // across all patches, not counting the one playing
const RING_PAD = 10;
const LABEL_GAP = 10; // between the ring and its label
const EDGE = 6; // the label stays this far inside the canvas
const EASE = "ease-out";

const whenDone = (a, fn) => a.finished.then(fn, fn);
const isShown = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

function div(cls, text) {
  const e = document.createElement("div");
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Pure scheduler: one change plays at a time, for playMs each. At most maxPending wait behind it;
 * a newer change drops the oldest waiting one, so focus never lags far behind the screen.
 */
export function createFocusQueue({ playMs = SPOTLIGHT_MS, maxPending = MAX_PENDING } = {}) {
  const queue = [];
  let until = -Infinity;
  return {
    enqueue(change) {
      queue.push(change);
      if (queue.length > maxPending) queue.splice(0, queue.length - maxPending);
    },
    /**
     * The change to start now, or null while one is playing or none is queued. `accept` drops stale ones.
     * @param {number} now
     * @param {(change: any) => boolean} [accept]
     */
    next(now, accept = () => true) {
      if (now < until) return null;
      while (queue.length) {
        const c = queue.shift();
        if (accept(c)) {
          until = now + playMs;
          return c;
        }
      }
      return null;
    },
    isPlaying: (now) => now < until,
    get size() {
      return queue.length;
    },
  };
}

/**
 * The changes of one patch worth a spotlight: visible, not inside another changed node, and,
 * when a patch touches many places at once, one spotlight on the region that holds them all.
 */
export function focusTargets(changes, nodes) {
  const picked = [];
  const seen = new Set();
  for (const c of changes) {
    if (c.kind === "screen" || seen.has(c.id)) continue; // a screen change is shown by its slide
    seen.add(c.id);
    const el = nodes.get(c.id);
    if (isShown(el)) picked.push({ c, el });
  }
  const top = picked.filter((p) => !picked.some((q) => q !== p && q.el.contains(p.el)));
  if (top.length <= MAX_SPOTLIGHTS_PER_PATCH) return top.map((p) => p.c);
  let region = top[0].el.parentElement.closest("[data-node-id]");
  while (region && !top.every((p) => region.contains(p.el))) region = region.parentElement.closest("[data-node-id]");
  return region ? [{ ...top[0].c, id: region.dataset.nodeId }] : [top[0].c];
}

const glide = (els, delta) => {
  for (const e of els) animate(e, [{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 450, easing: EASE });
};

// The App's content (its slot), which a scroll moves; the app frame's chrome stays put (sticky).
function contentOf(root) {
  const app = root.firstElementChild;
  return (app && app.dataset.type && slotOf(app, { type: app.dataset.type })) || app;
}

/**
 * Brings `el` (at `box`, from layoutBox) into view: first inside the container that scrolls it (the phone's
 * screen area), then on the canvas. Each scroll jumps, and the content glides from where it was; the app
 * frame's chrome does not move. Returns the box where it now shows.
 */
function reveal(root, el, box) {
  const scroller = scrollerOf(el, root);
  if (scroller) {
    const moved = scrollWithin(scroller, root, box);
    if (Math.abs(moved) >= 1) {
      glide([...scroller.children].filter(isShown), moved);
      box = { ...box, y: box.y - moved };
    }
  }
  // The sticky top bar covers the canvas top: what sits under it is not visible, and a reveal lands below it.
  const inset = topInset(root);
  const view = root.clientHeight;
  const top = root.scrollTop;
  if (box.y >= top + inset + 8 && box.y + box.h <= top + view - 8) return box;
  const max = Math.max(0, root.scrollHeight - view);
  const target = Math.min(max, Math.max(0, box.y - Math.max(64, inset + 24)));
  const delta = target - top;
  if (Math.abs(delta) < 1) return box;
  root.scrollTop = target;
  const content = contentOf(root);
  if (content) glide([content], delta);
  return box;
}

/**
 * Text and form fields on the canvas outside `target`, as boxes in the root's visible area: what
 * a label should not cover. Each is placed by its element's layout box, so a glide or the reveal
 * still in flight does not move it.
 */
function inkRects(root, target) {
  const rects = [];
  const skip = (el) => !el || target.contains(el) || !!el.closest(".m-focus, .m-ghost, .m-layer, .m-pending");
  const add = (el, r) => {
    const box = r.width > 0 && r.height > 0 ? layoutBox(el, root) : null;
    if (!box) return;
    const at = el.getBoundingClientRect();
    rects.push({ x: box.x + r.left - at.left - root.scrollLeft, y: box.y + r.top - at.top - root.scrollTop, w: r.width, h: r.height });
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim() || skip(n.parentElement)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) add(n.parentElement, r);
  }
  for (const f of root.querySelectorAll("input, select, textarea")) if (!skip(f)) add(f, f.getBoundingClientRect());
  return rects;
}

/**
 * Where the label goes, around `ring` in the root's visible area: above it on the left (the usual
 * spot), above on the right, below, or beside it, whichever covers the least of the other text on
 * the canvas, so it doesn't sit on the content above the change. Inside the ring's top edge when
 * none of those fits on the canvas.
 */
function placeLabel(root, ring, lw, lh, target) {
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const clampX = (x) => Math.max(EDGE, Math.min(x, vw - lw - EDGE));
  const above = ring.y - lh - LABEL_GAP;
  const below = ring.y + ring.h + LABEL_GAP;
  const middle = ring.y + (ring.h - lh) / 2;
  const spots = [
    { x: clampX(ring.x), y: above }, { x: clampX(ring.x + ring.w - lw), y: above },
    { x: clampX(ring.x), y: below }, { x: clampX(ring.x + ring.w - lw), y: below },
    { x: ring.x + ring.w + LABEL_GAP, y: middle }, { x: ring.x - lw - LABEL_GAP, y: middle },
  ].filter((s) => s.x >= EDGE && s.x + lw <= vw - EDGE && s.y >= EDGE && s.y + lh <= vh - EDGE);
  if (!spots.length) return { x: clampX(ring.x), y: Math.max(EDGE, ring.y + LABEL_GAP) };
  const ink = inkRects(root, target);
  const span = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const covered = (s) => ink.reduce((sum, r) => sum + span(s.x, s.x + lw, r.x, r.x + r.w) * span(s.y, s.y + lh, r.y, r.y + r.h), 0);
  let best = spots[0];
  let least = covered(best);
  for (const s of spots.slice(1)) {
    if (least === 0) break;
    const c = covered(s);
    if (c < least) [best, least] = [s, c];
  }
  return best;
}

let spotlight = null;

/**
 * Spotlight: for 1500 ms everything else dims to DIM, a ring surrounds `el`, and a label says
 * what changed and whose idea it was. The dimming is one veil layer with a hole (the same
 * pixels as fading everything else to 0.35 over the white app, at the cost of one layer).
 */
export function playFocus(el, change) {
  const root = rootOf(el);
  const found = root && layoutBox(el, root);
  if (!found) return;
  const box = reveal(root, el, found);
  if (spotlight) spotlight.remove();

  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const x = box.x - root.scrollLeft - RING_PAD;
  const tag = tagAbove(el);
  const y = box.y - root.scrollTop - Math.max(RING_PAD, tag ? tag + 5 : 0); // include the draft tag
  const w = box.w + RING_PAD * 2;
  const h = box.y - root.scrollTop + box.h + RING_PAD - y;

  const layer = div("m-focus");
  Object.assign(layer.style, { left: `${root.scrollLeft}px`, top: `${root.scrollTop}px`, width: `${vw}px`, height: `${vh}px` });
  layer.style.setProperty("--m-veil", String(1 - DIM));
  const hole = div("m-hole");
  const ring = div("m-ring");
  for (const e of [hole, ring]) Object.assign(e.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  const text = change.by ? `${change.label} · ${change.by}` : change.label;
  const label = div("m-label", text);
  layer.append(hole, ring, label);
  root.append(layer);

  const spot = placeLabel(root, { x, y, w, h }, label.offsetWidth, label.offsetHeight, el);
  Object.assign(label.style, { left: `${spot.x}px`, top: `${spot.y}px` });

  // 300 ms in, hold, 300 ms out.
  const a = animate(layer, [
    { opacity: 0, easing: EASE },
    { opacity: 1, offset: 0.2, easing: "linear" },
    { opacity: 1, offset: 0.8, easing: EASE },
    { opacity: 0 },
  ], { duration: SPOTLIGHT_MS });
  animate(ring, [{ transform: "scale(1.04)" }, { transform: "none" }], { duration: 350, easing: EASE });
  animate(label, [{ transform: "translateY(12px)" }, { transform: "none" }], { duration: 350, easing: EASE });
  spotlight = layer;
  whenDone(a, () => {
    layer.remove();
    if (spotlight === layer) spotlight = null;
  });
  logMotion({ fn: "playFocus", id: el.dataset.nodeId, label: text });
}

let pending = null; // { parent, el }

/** A shimmering placeholder at the end of `parentEl` where a streamed element is coming; null clears it. */
export function showPendingRegion(parentEl) {
  if (pending && pending.parent === parentEl && pending.el.isConnected) return;
  if (pending) {
    fadeOutInPlace(pending.el);
    pending = null;
  }
  logMotion({ fn: "showPendingRegion", id: parentEl ? parentEl.dataset.nodeId : null });
  if (!parentEl || !parentEl.isConnected) return;
  const slot = slotOf(parentEl, { type: parentEl.dataset.type }) ?? parentEl.parentElement;
  const el = div("m-pending");
  const bar = div("m-shimmer");
  el.append(bar, div("m-pending-label", "Builder is adding this…"));
  slot.append(el); // after every live child, so keyed placement is unaffected
  animate(el, [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE });
  // A slow, soft sweep (ambient, like the character's idle motion), not a flash.
  animate(bar, [{ transform: "translateX(-110%) skewX(-18deg)" }, { transform: "translateX(360%) skewX(-18deg)" }], { duration: 1400, iterations: Infinity, easing: EASE });
  pending = { parent: parentEl, el };
}

const POINTER_SVG = `<svg width="40" height="44" viewBox="0 0 20 22" aria-hidden="true">
<path d="M1 1 L1 17 L5.2 13.2 L8.2 20 L11 18.8 L8.1 12.2 L14 12.2 Z" fill="#101521" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const POINTER_IDLE_MS = 1200;
let pointer = null;
let pointerAt = null; // last resting point, null while hidden
let pointerIdle = null;

const at = (p, extra = "") => `translate(${p.x}px, ${p.y}px)${extra}`;

/** Voice command cue: the pointer glides to the target (500 ms), then presses (150 ms). */
export async function animatePointer(targetEl) {
  if (!isShown(targetEl)) return;
  // A target off the canvas (or below the phone's fold) is brought into view first; the pointer aims at
  // where it lands (its layout box), not where its glide starts.
  const root = rootOf(targetEl);
  const found = root && layoutBox(targetEl, root);
  let r = targetEl.getBoundingClientRect();
  if (found) {
    const box = reveal(root, targetEl, found);
    const rr = root.getBoundingClientRect();
    r = { left: rr.left + root.clientLeft + box.x - root.scrollLeft, top: rr.top + root.clientTop + box.y - root.scrollTop, width: box.w, height: box.h };
  }
  const to = { x: Math.round(r.left + Math.min(r.width / 2, 48)), y: Math.round(r.top + r.height / 2) };
  if (!pointer) {
    pointer = div("m-pointer");
    pointer.innerHTML = POINTER_SVG;
    document.body.append(pointer);
  }
  clearTimeout(pointerIdle);
  const from = pointerAt ?? { x: to.x + 150, y: to.y + 110 };
  const wasHidden = pointerAt === null;
  pointer.style.transform = at(to);
  pointer.style.opacity = "1";
  const id = targetEl.dataset.nodeId;
  logMotion({ fn: "animatePointer", phase: "glide", id });
  await animate(pointer, [{ transform: at(from), opacity: wasHidden ? 0 : 1 }, { transform: at(to), opacity: 1 }], { duration: 500, easing: EASE }).finished.catch(() => {});

  logMotion({ fn: "animatePointer", phase: "press", id });
  const ripple = div("m-ripple");
  ripple.style.transform = at(to);
  document.body.append(ripple);
  whenDone(animate(ripple, [{ transform: at(to, " scale(0.4)"), opacity: 0.9 }, { transform: at(to, " scale(1.5)"), opacity: 0 }], { duration: 400, easing: EASE }), () => ripple.remove());
  await animate(pointer, [{ transform: at(to) }, { transform: at(to, " scale(0.82)"), offset: 0.5 }, { transform: at(to) }], { duration: 150, easing: EASE }).finished.catch(() => {});

  pointerAt = to;
  pointerIdle = setTimeout(() => {
    pointerAt = null;
    pointer.style.opacity = "0";
    animate(pointer, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: EASE });
  }, POINTER_IDLE_MS);
}
