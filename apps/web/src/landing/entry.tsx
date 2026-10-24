// The landing pages' entry (ADR 0017): no Clerk, no router, no api client. main.tsx loads it for signed-out visitors.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LandingPage } from "./LandingPage.tsx";
import type { LandingPath } from "./paths.ts";

// `path` picks the page once /privacy and /terms have their own; until then every landing path shows the home page.
export function mountLanding(root: HTMLElement, _path: LandingPath) {
  createRoot(root).render(
    <StrictMode>
      <LandingPage />
    </StrictMode>,
  );
}
