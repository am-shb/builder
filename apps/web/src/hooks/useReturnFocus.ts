import { useRef } from "react";

// Where focus goes back to when a dialog closes. Radix returns focus to a dialog's Trigger, and ours have none (they
// open from code: a button elsewhere on the page, or a start that needs an answer), so without this focus falls to
// the top of the page. The element that had focus when the dialog opened is remembered and focused again on close;
// if there was none (Safari doesn't focus a clicked button) or it's gone, `fallback` is.
export function useReturnFocus(open: boolean, fallback?: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null);
  // Read while rendering the open dialog, before Radix moves focus into it.
  if (open && opener.current === null && typeof document !== "undefined" && document.activeElement instanceof HTMLElement
    && document.activeElement !== document.body) {
    opener.current = document.activeElement;
  }
  return (event: Event) => {
    event.preventDefault();
    const target = opener.current?.isConnected ? opener.current : fallback?.();
    opener.current = null;
    target?.focus();
  };
}
