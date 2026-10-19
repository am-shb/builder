import { useSyncExternalStore } from "react";

// Whether a media query matches, kept up to date. False where matchMedia doesn't exist.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
    () => false,
  );
}

// The desktop layout starts at 768px (ADR 0013): dialogs instead of sheets, the start panel instead of the action bar.
export const DESKTOP = "(min-width: 768px)";
