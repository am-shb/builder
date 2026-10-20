import type { ReactNode } from "react";
import { PRODUCT_NAME } from "../brand.ts";
import { cn } from "../lib/cn.ts";
import { Mark } from "./Mark.tsx";

// The frame of every signed-in page: the top bar (the mark and wordmark, then the org switcher and account slots),
// the faint dot texture, the content, and on phones an optional sticky action bar above the safe area.
export function AppShell({ org, account, actionBar, children }: {
  org?: ReactNode;
  account?: ReactNode;
  // Phones only (below 768px): the page's primary action, in thumb reach.
  actionBar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative isolate min-h-dvh", actionBar ? "pb-[calc(108px+env(safe-area-inset-bottom))] md:pb-18" : "pb-18")}>
      <div aria-hidden="true" className="dot-texture pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px] md:h-[420px]" />
      <a href="#main" className="sr-only rounded-full bg-surface px-4 py-2 font-semibold focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <header>
        <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-5 py-3 md:px-10 md:py-5">
          <a href="/" className="mr-auto flex min-h-11 items-center gap-2.5 rounded-xl text-ink no-underline">
            <Mark />
            <span className="text-[17px] font-[650] tracking-[-0.01em] max-[400px]:sr-only">{PRODUCT_NAME}</span>
          </a>
          {(org || account) && <div className="flex items-center gap-1">{org}{account}</div>}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1180px] px-5 pt-4 md:px-10 md:pt-9">
        {children}
      </main>
      {actionBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-[linear-gradient(to_top,var(--bg)_calc(100%-24px),transparent)] px-5 pt-7 pb-[calc(16px+env(safe-area-inset-bottom))] md:hidden">
          {actionBar}
        </div>
      )}
    </div>
  );
}

// A page's title and one-line purpose.
export function PageIntro({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="m-0 text-title font-semibold tracking-[-0.025em] md:text-title-lg">{title}</h1>
      {subtitle && <p className="mt-2 mb-0 max-w-[26em] text-ink-2">{subtitle}</p>}
      {children}
    </div>
  );
}

// Desktop: the intro and a panel on the left (they stay put while the list scrolls), the content on the right.
// Phones: one column, and the panel hides (its action lives in the sticky bar and a bottom sheet).
export function SplitLayout({ intro, panel, children }: { intro: ReactNode; panel?: ReactNode; children: ReactNode }) {
  return (
    <div className="md:grid md:grid-cols-[340px_minmax(0,1fr)] md:items-start md:gap-x-16">
      <div className="md:sticky md:top-8">
        {intro}
        {panel && <div className="mt-8 hidden rounded-panel bg-surface p-6 shadow-elevated md:block">{panel}</div>}
      </div>
      <div className="mt-7 md:mt-0 md:max-w-[720px]">{children}</div>
    </div>
  );
}

// A list's heading and its action. On desktop it shares a baseline with the page title beside it.
export function SectionHeader({ id, title, action }: { id?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-1 flex min-h-11 items-center justify-between md:mt-[var(--section-baseline,14px)]">
      <h2 id={id} className="m-0 text-label font-semibold text-ink-2">{title}</h2>
      {action}
    </div>
  );
}
