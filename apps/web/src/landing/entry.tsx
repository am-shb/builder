// The landing pages' entry (ADR 0017): no Clerk, no router, no api client. main.tsx loads it for signed-out visitors.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LandingPage } from "./LandingPage.tsx";
import { LegalPage } from "./LegalPage.tsx";
import type { LandingPath } from "./paths.ts";

export function mountLanding(root: HTMLElement, path: LandingPath) {
  createRoot(root).render(
    <StrictMode>
      {path === "/privacy" ? <LegalPage kind="privacy" /> : path === "/terms" ? <LegalPage kind="terms" /> : <LandingPage />}
    </StrictMode>,
  );
}
