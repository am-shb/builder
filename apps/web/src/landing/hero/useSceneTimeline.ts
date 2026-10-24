import { useEffect, useRef, useState } from "react";

// Steps through a looping scene: step i starts `times[i]` ms into the loop, and the loop restarts at `loopAt`. While
// `playing` is false (off screen, a background tab) it holds its step and picks up from there. With `still` set
// (reduced motion) it shows that step and runs no timers at all.
export function useSceneTimeline(times: readonly number[], loopAt: number, { playing, still }: { playing: boolean; still: number | null }): number {
  const [step, setStep] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (!playing || still !== null) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const k = current.current;
      const last = k + 1 >= times.length;
      const wait = (last ? loopAt : times[k + 1]!) - times[k]!;
      timer = setTimeout(() => {
        current.current = last ? 0 : k + 1;
        setStep(current.current);
        schedule();
      }, Math.max(0, wait));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [playing, still, times, loopAt]);

  return still ?? step;
}
