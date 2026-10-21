import { useEffect } from "react";
import { AppState } from "react-native";

// How often a screen that shows a session which may still change asks again (the web's WD6, on the engine's status
// events reaching the api).
export const AUTO_REFRESH_MS = 10_000;

// While `active`, calls `refresh` every AUTO_REFRESH_MS, only while the app is in the foreground: a backgrounded app
// asks nothing, and coming back asks at once, then on the timer again. Pass a quiet refresh (OrgQuery.quietRefresh).
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
      if (AppState.currentState === "active") timer = setInterval(refresh, ms);
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return stop();
      refresh();
      start();
    });
    start();
    return () => {
      stop();
      sub.remove();
    };
  }, [active, refresh, ms]);
}
