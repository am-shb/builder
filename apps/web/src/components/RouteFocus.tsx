import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

// How long after a move to a new page its heading may still be swapped (a loading page's heading for the loaded one).
const SETTLE_MS = 10_000;

// Moving to another page of the app starts at its top, with focus on its heading, as a page load would: the old page's
// scroll position doesn't carry over, and a screen reader reads where the person is now. Not on the first load, where
// the browser already does this. If the page then swaps its heading (loading, then loaded or "No such session") while
// focus was on it, focus follows to the new one, until the person moves focus themselves.
export function RouteFocus() {
  const { pathname } = useLocation();
  // The path focus was last set for; the first load's is the browser's. Compared, not a "first run" flag, so the
  // effect running twice on mount (React's StrictMode, in development) doesn't count as a move.
  const handled = useRef(pathname);
  useEffect(() => {
    if (handled.current === pathname) return;
    handled.current = pathname;
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
    // Once the person moves focus somewhere else, the page is theirs.
    const stop = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && e.target.tagName !== "H1" && e.target !== main) observer.disconnect();
    };
    document.addEventListener("focusin", stop);
    const timer = setTimeout(() => observer.disconnect(), SETTLE_MS);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", stop);
      clearTimeout(timer);
    };
  }, [pathname]);
  return null;
}
