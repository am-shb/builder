import { ArrowRight, Menu, SunMoon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { buttonVariants } from "../components/Button.tsx";
import { Mark } from "../components/Mark.tsx";
import { cn } from "../lib/cn.ts";
import { NAV_LINKS, PRODUCT_NAME, SIGN_IN, SIGN_UP } from "./copy.ts";
import { useInView } from "./useInView.ts";

// Off the first screen's path (ADR 0017), so a slow phone spends its bandwidth on the page itself: the color menu loads
// once the page has loaded and the browser is idle, or as soon as someone points at or focuses its button; the phone
// menu's sheet loads when Menu is first pressed.
const loadColorMenu = () => import("../components/ColorModeMenu.tsx").then((m) => ({ default: m.ColorModeMenu }));
const ColorModeMenu = lazy(loadColorMenu);
const ResponsiveModal = lazy(() => import("../components/ResponsiveModal.tsx").then((m) => ({ default: m.ResponsiveModal })));

let colorMenuWanted = false;
const wanters = new Set<() => void>();
function wantColorMenu() {
  if (colorMenuWanted) return;
  colorMenuWanted = true;
  for (const w of wanters) w();
}

// True once the page has finished loading and the browser has a quiet moment.
function useColorMenuWanted(): boolean {
  const [wanted, setWanted] = useState(colorMenuWanted);
  useEffect(() => {
    const on = () => setWanted(true);
    wanters.add(on);
    if (colorMenuWanted) on();
    const idle = () => (typeof requestIdleCallback === "function" ? requestIdleCallback(wantColorMenu, { timeout: 2500 }) : setTimeout(wantColorMenu, 1200));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      wanters.delete(on);
      window.removeEventListener("load", idle);
    };
  }, []);
  return wanted;
}

function ColorModeButton({ className }: { className?: string }) {
  const wanted = useColorMenuWanted();
  // Looks like the menu's button; pointing at it or focusing it loads the menu, which then takes its place.
  const placeholder = (
    <button
      type="button"
      aria-label="Color mode"
      onPointerEnter={wantColorMenu}
      onFocus={wantColorMenu}
      onClick={wantColorMenu}
      className={cn("grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunk hover:text-ink", className)}
    >
      <SunMoon aria-hidden="true" className="size-5" />
    </button>
  );
  if (!wanted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <ColorModeMenu className={className} />
    </Suspense>
  );
}

// Moves to a section by its #id and gives it focus, so the keyboard and screen readers continue from there.
export function goToSection(hash: string) {
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  history.pushState(null, "", hash);
  target.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
}

// The landing page's header. It sits on the page at the top and gets a frosted background once the page scrolls (a
// sentinel at the top is watched, so there's no scroll listener). From 1024px the section links are in the bar; below,
// they are in a sheet opened by Menu, with Sign in and the color mode.
export function LandingNav({ home = false }: { home?: boolean }) {
  const [topRef, atTop] = useInView<HTMLDivElement>();
  const [open, setOpen] = useState(false);
  // The sheet is mounted from the first press of Menu on, so it can animate open and closed after that.
  const [menuUsed, setMenuUsed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // A section link chosen in the sheet: followed once the sheet has closed and the page can scroll again.
  const pending = useRef<string | null>(null);
  const linkHref = (hash: string) => (home ? hash : `/${hash}`);

  const onSheetLink = (e: MouseEvent<HTMLAnchorElement>, hash: string) => {
    if (!home) return;
    e.preventDefault();
    pending.current = hash;
    setOpen(false);
  };

  return (
    <>
      <div ref={topRef} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-3 w-px" />
      <header
        className={cn(
          "sticky top-0 z-40 transition-[background-color,box-shadow] duration-300 ease-out",
          atTop ? "bg-transparent" : "bg-frost shadow-[0_1px_0_var(--hair)] backdrop-blur-xl backdrop-saturate-150",
        )}
      >
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1320px] 2xl:max-w-[1440px] items-center gap-1 px-4 sm:px-6 lg:h-[72px] lg:px-10">
          <a href="/" className="mr-auto flex min-h-11 items-center gap-2.5 rounded-xl pr-2 text-ink no-underline">
            <Mark />
            <span className="text-[17px] font-[650] tracking-[-0.01em]">{PRODUCT_NAME}</span>
          </a>
          <ul className="m-0 hidden list-none items-center gap-0.5 p-0 lg:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={linkHref(link.href)}
                  onClick={home ? (e) => { e.preventDefault(); goToSection(link.href); } : undefined}
                  className="flex min-h-11 items-center rounded-full px-3.5 text-label font-medium text-ink-2 no-underline transition-colors hover:bg-sunk hover:text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-1 lg:ml-4">
            <ColorModeButton className="hidden sm:grid" />
            <a href={SIGN_IN} className="hidden min-h-11 items-center rounded-full px-3.5 text-label font-semibold text-ink no-underline transition-colors hover:bg-sunk md:flex">
              Sign in
            </a>
            <a href={SIGN_UP} className={cn(buttonVariants({ size: "sm" }), "ml-1 no-underline max-[359px]:px-3")}>
              Start free
            </a>
            <button
              ref={menuButton}
              type="button"
              onClick={() => { setMenuUsed(true); setOpen(true); }}
              aria-haspopup="dialog"
              aria-expanded={open}
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-sunk lg:hidden"
            >
              <Menu aria-hidden="true" className="size-[22px]" strokeWidth={1.75} />
              <span className="sr-only">Menu</span>
            </button>
          </div>
        </nav>
      </header>
      {menuUsed && <Suspense fallback={null}><ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Menu"
        returnFocusTo={() => menuButton.current}
        onClosed={() => {
          const hash = pending.current;
          pending.current = null;
          if (hash) goToSection(hash);
        }}
      >
        <ul className="m-0 grid list-none gap-1 p-0">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={linkHref(link.href)}
                onClick={(e) => onSheetLink(e, link.href)}
                className="group flex min-h-14 items-center justify-between rounded-field px-3 text-heading font-semibold tracking-[-0.02em] text-ink no-underline transition-colors hover:bg-sunk"
              >
                {link.label}
                <ArrowRight aria-hidden="true" className="size-5 text-ink-3 transition-transform motion-safe:group-hover:translate-x-0.5" />
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-hair pt-4">
          <span className="text-label font-medium text-ink-2">Color mode</span>
          <ColorModeButton />
        </div>
        <div className="mt-4 grid gap-2.5">
          <a href={SIGN_UP} className={cn(buttonVariants({ block: true }), "no-underline")}>Start free</a>
          <a href={SIGN_IN} className={cn(buttonVariants({ variant: "secondary", block: true }), "no-underline")}>Sign in</a>
        </div>
      </ResponsiveModal></Suspense>}
    </>
  );
}
