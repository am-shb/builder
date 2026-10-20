import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Refreshable = { refresh: () => void; status: "loading" | "ready" | "error"; loadedAt: Date | undefined; error: unknown };

// Refresh changes nothing on screen when nothing changed, so a screen reader would hear nothing at all. After a
// Refresh the person asked for succeeds, this says "Updated." in a polite live region (a failure has its own alert).
// Reloads the page does on its own (after a start) say nothing. Returns the Refresh to call and the region to render.
export function useRefreshNews(query: Refreshable): { refresh: () => void; news: ReactNode } {
  // The load the person's Refresh started from, until a newer one arrives or it fails.
  const asked = useRef<Date | undefined | null>(null);
  // Each success is a new node, so "Updated." twice in a row is announced twice.
  const [done, setDone] = useState(0);
  const [shown, setShown] = useState(false);
  const { refresh: reload, status, loadedAt, error } = query;

  useEffect(() => {
    if (asked.current === null) return;
    if (status === "error") asked.current = null;
    else if (status === "ready" && loadedAt !== asked.current) {
      asked.current = null;
      setDone((n) => n + 1);
      setShown(true);
    }
    // `error` is new on each failure, so a failed Refresh is seen even when the status was already "error".
  }, [status, loadedAt, error]);

  // Gone after a few seconds, so it isn't read again later as stale news.
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), 4000);
    return () => clearTimeout(timer);
  }, [shown, done]);

  const refresh = useCallback(() => {
    asked.current = loadedAt;
    setShown(false);
    reload();
  }, [reload, loadedAt]);

  return { refresh, news: <span role="status" className="sr-only">{shown && <span key={done}>Updated.</span>}</span> };
}
