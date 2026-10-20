import { Copy, ExternalLink, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { BOT_NAME } from "../brand.ts";
import { Button, buttonVariants } from "../components/Button.tsx";
import { cn } from "../lib/cn.ts";
import { safeStageUrl } from "./detail.ts";

// The stage link (plan WD5). It carries the stage's control token, so it stays hidden until asked for, with a warning
// next to it. It's rendered as a link only if it's https (or http on the local dev server). Copying puts it on the
// clipboard; opening it uses a new tab with no opener and no referrer. It's never logged or stored by this page.
export function StageLink({ stageUrl, dev = import.meta.env.DEV }: { stageUrl: string | undefined; dev?: boolean }) {
  const [shown, setShown] = useState(false);
  // Each copy is a new event (n), so a second Copy restarts the timer and is announced again.
  const [copy, setCopy] = useState<{ kind: "idle" | "copied" | "failed"; n: number }>({ kind: "idle", n: 0 });
  const headingId = useId();
  const warningId = useId();
  const linkText = useRef<HTMLParagraphElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  // Showing or hiding swaps the button that had focus for others: focus follows, to Copy or back to Show.
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    (shown ? copyButton : showButton).current?.focus();
  }, [shown]);
  const toggle = (next: boolean) => {
    toggled.current = true;
    setShown(next);
    setCopy((c) => ({ kind: "idle", n: c.n }));
  };
  const url = safeStageUrl(stageUrl, { dev });

  // "Copied" goes away after a few seconds, so it doesn't stay on screen as stale news.
  useEffect(() => {
    if (copy.kind === "idle") return;
    const timer = setTimeout(() => setCopy((c) => ({ kind: "idle", n: c.n })), 4000);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopy((c) => ({ kind: "copied", n: c.n + 1 }));
    } catch {
      setCopy((c) => ({ kind: "failed", n: c.n + 1 }));
      // Selected, so it can be copied by hand.
      const range = document.createRange();
      if (linkText.current) {
        range.selectNodeContents(linkText.current);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
    }
  }

  return (
    <section aria-labelledby={headingId} className="rounded-panel bg-surface p-6 shadow-elevated">
      <h2 id={headingId} className="m-0 text-heading font-semibold tracking-[-0.015em]">Stage link</h2>
      {!stageUrl ? (
        <p className="mt-2 mb-0 text-ink-2">There's no stage link for this session.</p>
      ) : !url ? (
        <p className="mt-2 mb-0 text-ink-2">This session's stage link can't be shown here.</p>
      ) : (
        <>
          <div id={warningId} className="mt-3 flex gap-3 rounded-plate bg-warn-bg px-4 py-3.5 text-warn-ink">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
            <p className="m-0 text-sm">
              This link controls the stage shown in the meeting. Anyone with it can change what's on screen and interrupt{" "}
              {BOT_NAME}'s voice. Don't share it, and don't open it while the meeting is running unless you mean to.
              Opening it also saves it in this browser's history.
            </p>
          </div>
          {shown ? (
            <>
              <p ref={linkText} className="mt-4 mb-0 rounded-field bg-sunk px-4 py-3 font-mono text-sm break-all select-all text-ink">{url}</p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Button ref={copyButton} variant="secondary" size="sm" onClick={() => void copyLink()}><Copy aria-hidden="true" />Copy</Button>
                <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}>
                  <ExternalLink aria-hidden="true" />Open stage<span className="sr-only"> (opens in a new tab)</span>
                </a>
                <Button variant="quiet" size="sm" onClick={() => toggle(false)}><EyeOff aria-hidden="true" />Hide</Button>
              </div>
            </>
          ) : (
            <Button ref={showButton} variant="secondary" size="sm" className="mt-4" aria-describedby={warningId} onClick={() => toggle(true)}>
              <Eye aria-hidden="true" />Show stage link
            </Button>
          )}
          {/* Always mounted, so "Copied" is announced. */}
          <p role="status" className="m-0 mt-3 text-sm font-medium text-ink-2 empty:mt-0">
            {/* Keyed by the copy, so the same message twice is a new node and is announced again. */}
            {shown && copy.kind === "copied" && <span key={copy.n}>Copied.</span>}
            {shown && copy.kind === "failed" && <span key={copy.n}>Couldn't copy. The link is selected; copy it yourself.</span>}
          </p>
        </>
      )}
    </section>
  );
}
