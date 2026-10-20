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

// From 768px (ADR 0015): dialogs instead of sheets. The start panel replaces the action bar later, at 1024px (CSS `lg`).
export const DESKTOP = "(min-width: 768px)";
