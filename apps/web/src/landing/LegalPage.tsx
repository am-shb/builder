import "./landing.css";
import { usePageTitle } from "../hooks/usePageTitle.ts";
import { LEGAL } from "./copy.ts";
import { Footer } from "./Footer.tsx";
import { LandingNav } from "./LandingNav.tsx";
import { WRAP } from "./layout.tsx";

// /privacy and /terms: placeholders until the real documents exist, saying only what is true today.
export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const page = LEGAL[kind];
  usePageTitle(page.title);
  return (
    <div className="landing relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <a href="#main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <LandingNav />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <div className={`${WRAP} py-16 md:py-24`}>
          <div className="mx-auto max-w-[44rem]">
            <h1 className="display display-lg m-0">{page.title}</h1>
            <p className="mt-6 mb-0 rounded-plate bg-warn-bg px-5 py-4 text-warn-ink">{page.intro}</p>
            <ul className="mt-8 mb-0 grid gap-4 pl-5 text-ink-2 marker:text-ink-3">
              {page.points.map((p) => <li key={p} className="text-pretty">{p}</li>)}
            </ul>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
