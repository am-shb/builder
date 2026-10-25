import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, buttonVariants } from "../components/Button.tsx";
import { cn } from "../lib/cn.ts";
import { safeHandoffUrl } from "@builder/session-core";

// The handoff link (ADR 0008): the engine's read-only page with the decision log, the agreed prototype and the
// component spec, there once the meeting has ended. Made to be passed on to engineers, so it isn't hidden like the
// stage link, but the link itself isn't printed either: Open and Copy are enough. Rendered only if it's https (or http
// on the local dev server), and never logged or stored by this page. Nothing until the engine has sent it.
export function HandoffLink({ handoffUrl, dev = import.meta.env.DEV }: { handoffUrl: string | undefined; dev?: boolean }) {
  // Each copy is a new event (n), so a second Copy restarts the timer and is announced again.
  const [copy, setCopy] = useState<{ kind: "idle" | "copied" | "failed"; n: number }>({ kind: "idle", n: 0 });
  const headingId = useId();
  const url = safeHandoffUrl(handoffUrl, { dev });

  // "Copied" goes away after a few seconds, so it doesn't stay on screen as stale news.
  useEffect(() => {
    if (copy.kind === "idle") return;
    const timer = setTimeout(() => setCopy((c) => ({ kind: "idle", n: c.n })), 4000);
    return () => clearTimeout(timer);
  }, [copy]);

  if (!url) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopy((c) => ({ kind: "copied", n: c.n + 1 }));
    } catch {
      setCopy((c) => ({ kind: "failed", n: c.n + 1 }));
    }
  }

  return (
    <section aria-labelledby={headingId} className="rounded-panel bg-surface p-6 shadow-elevated">
      <h2 id={headingId} className="m-0 text-heading font-semibold tracking-[-0.015em]">Handoff</h2>
      <p className="mt-2 mb-0 text-ink-2">
        The decision log, the agreed prototype and the component spec, for the engineers who build it. Anyone with the
        link can read it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}>
          <ExternalLink aria-hidden="true" />Open handoff<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <Button variant="secondary" size="sm" onClick={() => void copyLink()}><Copy aria-hidden="true" />Copy link</Button>
      </div>
      {/* Always mounted, so "Copied" is announced. */}
      <p role="status" className="m-0 mt-3 text-sm font-medium text-ink-2 empty:mt-0">
        {/* Keyed by the copy, so the same message twice is a new node and is announced again. */}
        {copy.kind === "copied" && <span key={copy.n}>Copied.</span>}
        {copy.kind === "failed" && <span key={copy.n}>Couldn't copy. Open the handoff and copy its address instead.</span>}
      </p>
    </section>
  );
}
