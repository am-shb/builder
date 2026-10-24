// The public pages (ADR 0017). Everything else is the app.
export const LANDING_PATHS = ["/", "/privacy", "/terms"] as const;
export type LandingPath = (typeof LANDING_PATHS)[number];

// "/privacy/" and "/privacy" are the same page.
export function normalPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function isLandingPath(path: string): path is LandingPath {
  return (LANDING_PATHS as readonly string[]).includes(path);
}
