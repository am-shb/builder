import type { ReactNode } from "react";
import { Mark } from "../components/Mark.tsx";
import { CONTACT_EMAIL, FOOTER, mailto, NAV_LINKS, PRODUCT_NAME, SIGN_IN, SIGN_UP } from "./copy.ts";
import { goToSection } from "./LandingNav.tsx";
import { WRAP } from "./layout.tsx";

const linkClass = "inline-flex min-h-11 items-center text-ink-2 no-underline transition-colors hover:text-ink hover:underline";

export function Footer({ home = false }: { home?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-hair pt-14 pb-10">
      <div className={WRAP}>
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <a href="/" className="flex w-fit min-h-11 items-center gap-2.5 rounded-xl text-ink no-underline">
              <Mark />
              <span className="text-[17px] font-[650] tracking-[-0.01em]">{PRODUCT_NAME}</span>
            </a>
            <p className="mt-3 mb-0 max-w-[24em] text-sm text-ink-2">{FOOTER.tagline}</p>
          </div>
          <FooterColumn title="Product">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={home ? l.href : `/${l.href}`} onClick={home ? (e) => { e.preventDefault(); goToSection(l.href); } : undefined} className={linkClass}>{l.label}</a>
              </li>
            ))}
          </FooterColumn>
          <FooterColumn title="Account">
            <li><a href={SIGN_UP} className={linkClass}>Start free</a></li>
            <li><a href={SIGN_IN} className={linkClass}>Sign in</a></li>
          </FooterColumn>
          <FooterColumn title="Company">
            <li><a href={mailto(`About ${PRODUCT_NAME}`)} className={linkClass}>Contact</a></li>
            <li><a href="/privacy" className={linkClass}>Privacy</a></li>
            <li><a href="/terms" className={linkClass}>Terms</a></li>
          </FooterColumn>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-6 text-sm text-ink-3">
          <p className="m-0">© {year} {PRODUCT_NAME}</p>
          <p className="m-0"><a href={mailto(`About ${PRODUCT_NAME}`)} className="text-ink-3 no-underline hover:text-ink hover:underline">{CONTACT_EMAIL}</a></p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="m-0 text-sm font-semibold text-ink">{title}</h2>
      <ul className="mt-2 mb-0 grid list-none gap-0 p-0 text-[15px]">{children}</ul>
    </nav>
  );
}
