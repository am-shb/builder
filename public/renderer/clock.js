// The shared 15 fps clock. Meet only receives 15 fps from the bot, so every animation on the
// stage (CSS and Web Animations alike) is paused and stepped here instead of letting Chrome
// composite at 60: ~4x fewer frames on the bot's small CPU, no visible difference in the call.
// The module has no DOM side effects at load, so Node can import it for unit tests.

export const FPS = 15;
const LOG_MAX = 500;

export function createClock({
  fps = FPS,
  now = () => performance.now(),
  getAnimations = () => document.getAnimations(),
} = {}) {
  const origin = new WeakMap(); // Animation -> clock time at which its currentTime was 0
  const callbacks = new Set();
  let timer = null;

  function step(a, t) {
    if (a.playState === "finished" || a.playState === "idle") return;
    if (!origin.has(a)) origin.set(a, t - (Number(a.currentTime) || 0));
    if (a.playState !== "paused") a.pause();
    const local = t - origin.get(a);
    const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
    if (Number.isFinite(end) && local >= end) a.finish(); // resolves .finished; fill:none drops it
    else a.currentTime = local;
  }

  function tick() {
    const t = now();
    for (const a of getAnimations()) step(a, t);
    for (const cb of callbacks) {
      try {
        cb(t);
      } catch (err) {
        console.error("clock frame callback failed", err);
      }
    }
  }

  return {
    tick,
    now,
    start() {
      if (!timer) timer = setInterval(tick, 1000 / fps);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    get running() {
      return timer !== null;
    },
    /** Takes a freshly created animation off Chrome's timeline at once, starting at the current clock time. */
    adopt(a) {
      if (!timer) return a; // no clock (plain renderer page): let Chrome run it
      origin.set(a, now() - (Number(a.currentTime) || 0));
      a.pause();
      return a;
    },
    /** Runs `cb(now)` on every tick; returns an unsubscribe function. */
    onFrame(cb) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
  };
}

// The stage's one shared instance.
export const clock = createClock();
export const startClock = () => clock.start();
export const onFrame = (cb) => clock.onFrame(cb);
export const now = () => clock.now();

const willChange = new WeakMap(); // element -> number of live animations holding its layer

/**
 * element.animate(), stepped by the shared clock. The element gets its own compositor layer
 * (will-change) while animated, so a step changes only transform/opacity and never repaints.
 */
export function animate(el, keyframes, options) {
  const n = willChange.get(el) ?? 0;
  willChange.set(el, n + 1);
  if (n === 0) el.style.willChange = "transform, opacity";
  const a = el.animate(keyframes, { fill: "none", ...options });
  clock.adopt(a);
  const release = () => {
    const left = (willChange.get(el) ?? 1) - 1;
    willChange.set(el, left);
    if (left === 0) el.style.willChange = "";
  };
  a.finished.then(release, release); // cancel() rejects
  return a;
}

/** Test spy: appends to window.__motionLog when a test has created it. */
export function logMotion(entry) {
  const log = typeof window !== "undefined" ? window.__motionLog : undefined;
  if (!Array.isArray(log)) return;
  log.push({ ...entry, t: now() });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}
