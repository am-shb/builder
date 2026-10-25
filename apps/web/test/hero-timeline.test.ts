import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAFE } from "../src/landing/hero/CafeRoom.tsx";
import { SALES } from "../src/landing/hero/SalesRoom.tsx";
import { EXIT, EXIT_MS, buildTimeline, locate, progress } from "../src/landing/hero/timeline.ts";
import { useSceneTimeline } from "../src/landing/hero/useSceneTimeline.ts";

// The hero's two meetings on one loop (src/landing/hero/timeline.ts).
describe("the hero's timeline", () => {
  const tl = buildTimeline([CAFE, SALES]);

  it("plays each room, then its exit (out, the next meeting's card, a gap), then the next room, in under a minute", () => {
    expect(tl.times.length).toBe(CAFE.times.length + SALES.times.length + 6);
    for (let i = 1; i < tl.times.length; i++) expect(tl.times[i]!).toBeGreaterThan(tl.times[i - 1]!);
    expect(tl.times[tl.starts[1]!]! - tl.times[tl.exits[0]!]!).toBe(EXIT_MS);
    expect(tl.loopAt - tl.times[tl.exits[1]!]!).toBe(EXIT_MS);
    // The card shows for about a second, after the room has gone and before the next comes.
    expect(tl.times[tl.exits[0]! + 1]! - tl.times[tl.exits[0]!]!).toBe(EXIT.card);
    expect(EXIT.gap - EXIT.card).toBe(1000);
    expect(EXIT.next - EXIT.gap).toBeGreaterThanOrEqual(420);
    expect(tl.loopAt).toBeLessThan(60_000);
  });

  it("names one room at every step, switching to the next as the last one leaves", () => {
    expect(locate(tl, 0)).toEqual({ room: 0, local: 0, exit: null, shown: 0 });
    expect(locate(tl, tl.exits[0]!)).toEqual({ room: 0, local: null, exit: "out", shown: 1 });
    expect(locate(tl, tl.exits[0]! + 1)).toEqual({ room: 0, local: null, exit: "card", shown: 1 });
    expect(locate(tl, tl.exits[0]! + 2)).toEqual({ room: 0, local: null, exit: "gap", shown: 1 });
    expect(locate(tl, tl.starts[1]!)).toEqual({ room: 1, local: 0, exit: null, shown: 1 });
    expect(locate(tl, tl.exits[1]! + 1)).toEqual({ room: 1, local: null, exit: "card", shown: 0 });
  });

  it("the progress bar runs from the exit before a room to its own exit", () => {
    expect(progress(tl, tl.exits[1]!)).toEqual({ elapsed: 0, length: CAFE.length + EXIT_MS });
    expect(progress(tl, 0).elapsed).toBe(EXIT_MS);
    expect(progress(tl, tl.exits[0]!)).toEqual({ elapsed: 0, length: SALES.length + EXIT_MS });
    expect(progress(tl, tl.starts[1]!).elapsed).toBe(EXIT_MS);
  });

  it("every room step ends before the room's exit, and each still is one of its steps", () => {
    for (const room of [CAFE, SALES]) {
      expect(room.times.at(-1)!).toBeLessThan(room.length);
      expect(room.still).toBeGreaterThan(0);
      expect(room.still).toBeLessThan(room.times.length);
    }
  });
});

describe("the hero's step timer", () => {
  const times = [0, 1000, 3000] as const;
  afterEach(() => { vi.useRealTimers(); });

  it("after a pause, waits only what was left of the step", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ playing }) => useSceneTimeline(times, 4000, { playing, still: null }), { initialProps: { playing: true } });
    act(() => { vi.advanceTimersByTime(700); });
    rerender({ playing: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current[0]).toBe(0);
    rerender({ playing: true });
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current[0]).toBe(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe(1);
  });

  it("a jump starts its step afresh, and the loop carries on from there", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSceneTimeline(times, 4000, { playing: true, still: null }));
    act(() => { vi.advanceTimersByTime(900); });
    act(() => { result.current[1](2); });
    expect(result.current[0]).toBe(2);
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current[0]).toBe(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe(0);
  });
});
