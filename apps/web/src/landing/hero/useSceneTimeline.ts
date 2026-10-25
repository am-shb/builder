import { useCallback, useEffect, useRef, useState } from "react";

// Steps through a looping scene: step i starts `times[i]` ms into the loop, and the loop restarts at `loopAt`. While
// `playing` is false (off screen, a background tab) it holds its step, and when it plays again it waits only what was
// left of that step, so anything timed alongside it (a progress bar) stays in step. With `still` set (reduced motion)
// it shows that step and runs no timers at all. The first time through it can open at a later step (`start`); every
// loop after that begins at step 0. `jump` moves to a step at once; the loop carries on from there.
export function useSceneTimeline(
  times: readonly number[],
  loopAt: number,
  { playing, still, start = 0 }: { playing: boolean; still: number | null; start?: number },
): [number, (step: number) => void] {
  const [step, setStep] = useState(start);
  const current = useRef(start);
  // What was left of the current step when it was paused; null after a jump or a new step.
  const left = useRef<number | null>(null);
  // Bumped by a jump, so the next step is timed from the step jumped to.
  const [jumps, setJumps] = useState(0);

  // A jump starts its step afresh: whatever was left of the old step (saved as the effect is cleaned up) is dropped.
  // Effects run in order after all cleanups, so this runs before the timer below reads it.
  useEffect(() => { left.current = null; }, [jumps]);

  useEffect(() => {
    if (!playing || still !== null) return;
    let timer: ReturnType<typeof setTimeout>;
    let due = 0;
    const schedule = () => {
      const k = current.current;
      const last = k + 1 >= times.length;
      const wait = left.current ?? (last ? loopAt : times[k + 1]!) - times[k]!;
      left.current = null;
      due = Date.now() + wait;
      timer = setTimeout(() => {
        // A jump has moved on since this was scheduled.
        if (current.current !== k) return;
        current.current = last ? 0 : k + 1;
        setStep(current.current);
        schedule();
      }, Math.max(0, wait));
    };
    schedule();
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, due - Date.now());
    };
  }, [playing, still, times, loopAt, jumps]);

  const jump = useCallback((to: number) => {
    current.current = to;
    setStep(to);
    setJumps((j) => j + 1);
  }, []);

  return [still ?? step, jump];
}
