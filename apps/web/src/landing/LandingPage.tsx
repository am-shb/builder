import "./landing.css";
import { useEffect } from "react";
import { HOME_TITLE } from "./copy.ts";
import { Footer } from "./Footer.tsx";
import { Hero } from "./hero/Hero.tsx";
import { LandingNav } from "./LandingNav.tsx";
import { trackSpotlight } from "./layout.tsx";
import { BeforeAfter } from "./sections/BeforeAfter.tsx";
import { Demo } from "./sections/Demo.tsx";
import { Faq } from "./sections/Faq.tsx";
import { Features } from "./sections/Features.tsx";
import { FinalCta } from "./sections/FinalCta.tsx";
import { HowItWorks } from "./sections/HowItWorks.tsx";
import { Pricing } from "./sections/Pricing.tsx";
import { Trust } from "./sections/Trust.tsx";

// The public page at `/` (ADR 0017). Each section is its own file in sections/; the words are in copy.ts.
export function LandingPage() {
  // The same title as the one index.html is built with (build/meta.ts), so the tab doesn't change on load.
  useEffect(() => {
    document.title = HOME_TITLE;
  }, []);
  return (
    <div className="landing relative isolate min-h-dvh overflow-x-clip">
      <a href="#main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <LandingNav home />
      <main id="main" tabIndex={-1} className="outline-none" onPointerMove={trackSpotlight}>
        <Hero />
        <BeforeAfter />
        <HowItWorks />
        <Features />
        <Demo />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer home />
    </div>
  );
}

export default LandingPage;
