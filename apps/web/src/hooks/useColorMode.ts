import { useSyncExternalStore } from "react";
import { getColorMode, setColorMode, subscribeColorMode, type ColorMode } from "../lib/color-mode.ts";

// One setter for every caller, stable across renders.
const setMode = (mode: ColorMode) => setColorMode(mode);

// The person's color mode and a way to change it. Every toggle on the page, and other tabs, stay in step.
export function useColorMode(): [ColorMode, (mode: ColorMode) => void] {
  const mode = useSyncExternalStore(subscribeColorMode, getColorMode, () => "system" as const);
  return [mode, setMode];
}
