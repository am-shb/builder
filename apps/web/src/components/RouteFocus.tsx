import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

// How long after a move to a new page its heading may still be swapped (a loading page's heading for the loaded one).
const SETTLE_MS = 10_000;

// Clerk's sign-in and sign-up move between their own steps (/sign-in → /sign-in/factor-one) and focus their next
// field themselves: a step inside one of these isn't a move to another page.
const FLOWS = ["/sign-in", "/sign-up"];
const flowOf = (path: string) => FLOWS.find((f) => path === f || path.startsWith(`${f}/`));

// Moving to another page of the app starts at its top, with focus on its heading, as a page load would: the old page's
// scroll position doesn't carry over, and a screen reader reads where the person is now. Not on the first load, where
// the browser already does this, nor the redirects that are part of it (/ → /sign-in), nor a step inside Clerk's
// sign-in or sign-up. If the page then swaps its heading (loading, then loaded or "No such session") while focus was
// on it, focus follows to the new one, until the person does anything (a key, a click or tap, or focus elsewhere).
export function RouteFocus() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  // The path focus was last set for; the first load's is the browser's. Compared, not a "first run" flag, so the
  // effect running twice on mount (React's StrictMode, in development) doesn't count as a move.
  const handled = useRef(pathname);
  // Until the person first moves (a link, Back or Forward), redirects (REPLACE) still belong to the first load.
  const moved = useRef(false);
  useEffect(() => {
    if (handled.current === pathname) return;
    const from = handled.current;
    handled.current = pathname;
    if (navigationType !== "REPLACE") moved.current = true;
    if (!moved.current) return;
    if (flowOf(from) && flowOf(from) === flowOf(pathname)) return;

    window.scrollTo(0, 0);
    const main = document.getElementById("main");
    if (!main) return;
    const focusHeading = () => {
      const target = main.querySelector<HTMLElement>("h1") ?? main;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    };
    focusHeading();
    const lost = () => !document.activeElement || document.activeElement === document.body;
    const observer = new MutationObserver(() => {
      if (lost()) focusHeading();
    });
    observer.observe(main, { childList: true, subtree: true });
    // Once the person does anything, the page is theirs: focus moved elsewhere, a key, or a click or tap (which may
    // leave focus on the page itself, as clicking text or a button in Safari does).
    const stop = () => observer.disconnect();
    const stopOnFocus = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName !== "H1" && e.target !== main) stop();
    };
    document.addEventListener("focusin", stopOnFocus);
    document.addEventListener("keydown", stop, true);
    document.addEventListener("pointerdown", stop, true);
    const timer = setTimeout(stop, SETTLE_MS);
    return () => {
      stop();
      document.removeEventListener("focusin", stopOnFocus);
      document.removeEventListener("keydown", stop, true);
      document.removeEventListener("pointerdown", stop, true);
      clearTimeout(timer);
    };
  }, [pathname, navigationType]);
  return null;
}
