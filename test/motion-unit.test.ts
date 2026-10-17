import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Renderer modules import each other through the browser import map ("@renderer/..."); map it for Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@renderer/")) {
      return nextResolve(new URL(`../public/renderer/${specifier.slice("@renderer/".length)}`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createFocusQueue } = await import("../public/renderer/focus.js");
const { createClock } = await import("../public/renderer/clock.js");

const change = (id: string) => ({ kind: "added", id, label: `Added ${id}`, by: "Ada" });

test("focus queue plays changes one at a time for 1500ms each", () => {
  const q = createFocusQueue({ playMs: 1500 });
  q.enqueue(change("a"));
  q.enqueue(change("b"));
  q.enqueue(change("c"));
  assert.equal(q.isPlaying(0), false);
  assert.equal(q.next(0)?.id, "a");
  assert.equal(q.isPlaying(0), true);
  assert.equal(q.next(100), null, "nothing new while a spotlight is playing");
  assert.equal(q.next(1499), null);
  assert.equal(q.isPlaying(1499), true);
  assert.equal(q.next(1500)?.id, "b");
  assert.equal(q.next(3000)?.id, "c");
  assert.equal(q.next(4500), null, "queue drained");
  assert.equal(q.isPlaying(4499), true);
  assert.equal(q.isPlaying(4500), false);
});

test("focus queue skips changes the caller cannot play without spending a slot", () => {
  const q = createFocusQueue({ playMs: 1500 });
  q.enqueue(change("gone"));
  q.enqueue(change("b"));
  assert.equal(q.next(0, (c: { id: string }) => c.id !== "gone")?.id, "b");
  assert.equal(q.next(1500), null);
});

type FakeAnim = {
  playState: string; currentTime: number | null; paused: number; finished: number;
  pause(): void; finish(): void; effect: { getComputedTiming(): { endTime: number } };
};
function fakeAnim(endTime: number, currentTime = 0): FakeAnim {
  return {
    playState: "running", currentTime, paused: 0, finished: 0,
    pause() { this.paused++; this.playState = "paused"; },
    finish() { this.finished++; this.playState = "finished"; this.currentTime = endTime; },
    effect: { getComputedTiming: () => ({ endTime }) },
  };
}

test("clock steps every animation on its ticks and finishes ended ones", () => {
  let t = 1000;
  const anims: FakeAnim[] = [];
  const frames: number[] = [];
  const clock = createClock({ now: () => t, getAnimations: () => anims.filter((a) => a.playState !== "finished") });
  clock.onFrame((now: number) => frames.push(now));

  const css = fakeAnim(Infinity, 200); // a CSS animation already 200 ms in
  const once = fakeAnim(350);
  anims.push(css, once);
  clock.tick();
  assert.equal(css.playState, "paused");
  assert.equal(css.currentTime, 200, "keeps its own progress when adopted");
  assert.equal(once.currentTime, 0);

  t = 1067;
  clock.tick();
  assert.equal(css.currentTime, 267);
  assert.equal(once.currentTime, 67);

  t = 1400;
  clock.tick();
  assert.equal(once.finished, 1, "an animation past its end is finished, so its promise resolves");
  assert.equal(css.currentTime, 600);
  assert.deepEqual(frames, [1000, 1067, 1400]);
});

test("clock adopts animations created between ticks at the current clock time", () => {
  let t = 5000;
  const anims: FakeAnim[] = [];
  const clock = createClock({ now: () => t, getAnimations: () => anims });
  clock.start();
  try {
    const a = fakeAnim(400);
    anims.push(a);
    clock.adopt(a);
    assert.equal(a.playState, "paused", "paused at once: never runs on Chrome's 60 fps timeline");
    t = 5100;
    clock.tick();
    assert.equal(a.currentTime, 100);
  } finally {
    clock.stop();
  }
});
