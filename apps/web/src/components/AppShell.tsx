import type { ReactNode } from "react";
import { PRODUCT_NAME } from "../brand.ts";
import { cn } from "../lib/cn.ts";
import { ColorModeMenu } from "./ColorModeMenu.tsx";
import { Mark } from "./Mark.tsx";

// The frame of every signed-in page: the top bar (the mark and wordmark, then the org switcher, the color mode and the
// account slots),
// the faint dot texture, the content, and on phones an optional sticky action bar above the safe area.
export function AppShell({ org, account, actionBar, homeLink = plainHomeLink, children }: {
  org?: ReactNode;
  account?: ReactNode;
  // Below 1024px, where the page has no side panel: the page's primary action, in thumb reach.
  actionBar?: ReactNode;
  // Renders the mark's link home: the router's link inside the app, so it doesn't reload the page. A plain link where
  // there's no router (the not-configured page).
  homeLink?: (props: { className: string; children: ReactNode }) => ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative isolate min-h-dvh", actionBar ? "pb-[calc(108px+env(safe-area-inset-bottom))] lg:pb-18" : "pb-18")}>
      <div aria-hidden="true" className="dot-texture pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px] md:h-[420px]" />
      <a href="#main" className="sr-only rounded-full bg-surface px-4 py-2 font-semibold focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <header>
        <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-5 py-3 md:px-10 md:py-5">
          {homeLink({
            className: "mr-auto flex min-h-11 items-center gap-2.5 rounded-xl text-ink no-underline",
            children: (
              <>
                <Mark />
                <span className="text-[17px] font-[650] tracking-[-0.01em] max-[400px]:sr-only">{PRODUCT_NAME}</span>
              </>
            ),
          })}
          <div className="flex min-w-0 items-center gap-1">{org}<ColorModeMenu />{account}</div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1180px] px-5 pt-4 md:px-10 md:pt-9">
        {children}
      </main>
      {actionBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-[linear-gradient(to_top,var(--bg)_calc(100%-24px),transparent)] px-5 pt-7 pb-[calc(16px+env(safe-area-inset-bottom))] lg:hidden">
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

// 1024px and up: the intro and a panel on the left, the content on the right. The left column stays put while the list
// scrolls, when the window is tall enough to show all of it. Below 1024px: one column, so the meeting codes keep their
// full width, and the panel hides (its action lives in the sticky bar and a sheet or dialog).
export function SplitLayout({ intro, panel, children }: { intro: ReactNode; panel?: ReactNode; children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-x-16">
      <div className="lg:[@media(min-height:640px)]:sticky lg:[@media(min-height:640px)]:top-8">
        {intro}
        {panel && <div className="mt-8 hidden rounded-panel bg-surface p-6 shadow-elevated lg:block">{panel}</div>}
      </div>
      <div className="mt-7 lg:mt-0 lg:max-w-[720px]">{children}</div>
    </div>
  );
}

// A list's heading and its action. Beside the page title (1024px and up), it shares the title's baseline.
export function SectionHeader({ id, title, action }: { id?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-1 flex min-h-11 items-center justify-between lg:mt-3.5">
      <h2 id={id} className="m-0 text-label font-semibold text-ink-2">{title}</h2>
      {action}
    </div>
  );
}

function plainHomeLink({ className, children }: { className: string; children: ReactNode }) {
  return <a href="/" className={className}>{children}</a>;
}
