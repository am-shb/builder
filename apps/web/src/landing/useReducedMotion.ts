import { useMediaQuery } from "../hooks/useMediaQuery.ts";

// The person asked for less motion: animations show their last frame and timers don't run.
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION);
}
