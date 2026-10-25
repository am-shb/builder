import type { ReactNode } from "react";
import { Mark } from "../components/Mark.tsx";
import { androidAppUrl } from "../lib/android-app-url.ts";
import { ANDROID_APP, FOOTER, NAV_LINKS, PRODUCT_NAME, SIGN_IN, SIGN_UP } from "./copy.ts";
import { goToSection } from "./LandingNav.tsx";
import { WRAP } from "./layout.tsx";

// Links keep a 44px tap target on touch-sized screens (36px from lg up); the rows sit flush so the list stays tight.
const linkBase = "inline-flex min-h-11 items-center lg:min-h-9 no-underline transition-colors hover:text-ink hover:underline";
const linkClass = `${linkBase} text-ink-2`;
const dot = <span aria-hidden="true" className="select-none text-ink-3/70">·</span>;

export function Footer({ home = false }: { home?: boolean }) {
  const year = new Date().getFullYear();
  const androidApp = androidAppUrl();
  return (
    <footer className="border-t border-hair pt-10 pb-4 md:pt-14 md:pb-6">
      <div className={WRAP}>
        <div className="grid gap-8 md:flex md:items-start md:justify-between md:gap-12">
          <div className="md:max-w-[22rem]">
            <a href="/" className="-my-1 flex w-fit min-h-11 items-center gap-2.5 rounded-xl text-ink no-underline">
              <Mark />
              <span className="text-[17px] font-[650] tracking-[-0.01em]">{PRODUCT_NAME}</span>
            </a>
            <p className="mt-2 mb-0 max-w-[26em] text-sm text-pretty text-ink-2">{FOOTER.tagline}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 md:grid-cols-[auto_auto] md:gap-x-16 lg:gap-x-24">
            <FooterColumn title="Product">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={home ? l.href : `/${l.href}`} onClick={home ? (e) => { e.preventDefault(); goToSection(l.href); } : undefined} className={linkClass}>{l.label}</a>
                </li>
              ))}
              {androidApp && <li><a href={androidApp} className={linkClass}>{ANDROID_APP.footer}</a></li>}
            </FooterColumn>
            <FooterColumn title="Account">
              <li><a href={SIGN_UP} className={linkClass}>Start free</a></li>
              <li><a href={SIGN_IN} className={linkClass}>Sign in</a></li>
            </FooterColumn>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-2.5 border-t border-hair pt-2 text-sm text-ink-3 md:mt-12 md:justify-between md:pt-3">
          {/* On a phone the legal links take their own line, under this one. */}
          <p className="m-0 max-md:w-full">© {year} {PRODUCT_NAME} {dot} {FOOTER.builtAt}</p>
          <nav aria-label="Legal">
            <ul className="m-0 flex list-none items-center gap-x-2.5 p-0 md:gap-x-6">
              <li><a href="/privacy" className={`${linkBase} text-ink-3`}>Privacy</a></li>
              <li aria-hidden="true" className="md:hidden">{dot}</li>
              <li><a href="/terms" className={`${linkBase} text-ink-3`}>Terms</a></li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="m-0 text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">{title}</h2>
      <ul className="mt-1.5 mb-0 grid list-none p-0 text-[15px]">{children}</ul>
    </nav>
  );
}
