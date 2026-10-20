import { useSyncExternalStore } from "react";
import { getColorMode, setColorMode, subscribeColorMode, type ColorMode } from "../lib/color-mode.ts";

// The person's color mode and a way to change it. Every toggle on the page, and other tabs, stay in step.
export function useColorMode(): [ColorMode, (mode: ColorMode) => void] {
  const mode = useSyncExternalStore(subscribeColorMode, getColorMode, () => "system" as const);
  return [mode, setColorMode];
}
