import "./landing.css";
import { usePageTitle } from "../hooks/usePageTitle.ts";
import { Hero } from "./hero/Hero.tsx";
import { LandingNav } from "./LandingNav.tsx";

// The public page at `/` (ADR 0017). Each section is its own file in sections/.
export function LandingPage() {
  usePageTitle("Your meeting ends with a working prototype");
  return (
    <div className="landing relative isolate min-h-dvh overflow-x-clip">
      <a href="#main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <LandingNav home />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
      </main>
    </div>
  );
}

export default LandingPage;
