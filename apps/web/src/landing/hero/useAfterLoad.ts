import { useEffect, useState } from "react";

// True once the page has loaded, the browser has had a quiet moment and `wait` ms more have passed, so a loop's first
// steps don't compete with the page's own first work. With `skip` set it stays false and schedules nothing.
export function useAfterLoad(skip = false, wait = 0): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (skip) return;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => { timer = setTimeout(() => setReady(true), wait); };
    const idle = () => {
      if (typeof requestIdleCallback === "function") idleId = requestIdleCallback(go, { timeout: 1500 });
      else timer = setTimeout(go, 600);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      window.removeEventListener("load", idle);
      if (idleId !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [skip, wait]);
  return ready;
}
