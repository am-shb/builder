import { useEffect } from "react";

// How often a page that shows a session which may still change asks again (A2: the engine's status events reach the
// api, and the page picks them up). Plan WD6.
export const AUTO_REFRESH_MS = 10_000;

// While `active`, calls `refresh` every AUTO_REFRESH_MS, only while the tab is visible: a hidden tab asks nothing, and
// coming back asks at once, then on the timer again. Pass a quiet refresh (OrgQuery.quietRefresh), so nothing on
// screen flickers and nothing is announced.
export function useAutoRefresh(active: boolean, refresh: () => void, ms = AUTO_REFRESH_MS): void {
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      if (document.visibilityState === "visible") timer = setInterval(refresh, ms);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      refresh();
      start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, refresh, ms]);
}
