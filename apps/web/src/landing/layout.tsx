import { createElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

// The landing page's content width, the same as the header's.
export const WRAP = "mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-10 2xl:max-w-[1440px]";

// A section of the page: a landmark named by its heading, which the nav's links can move focus to.
export function Section({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} tabIndex={-1} className={cn("relative py-20 outline-none md:py-24 lg:py-28", className)}>
      <div className={WRAP}>{children}</div>
    </section>
  );
}

// A section's small label, its heading (the display font, like the hero's) and one line under it.
export function SectionHeader({ id, eyebrow, title, lead, align = "center", className }: {
  id: string; eyebrow: string; title: string; lead?: string; align?: "center" | "start"; className?: string;
}) {
  return (
    <Reveal className={cn("max-w-[46rem]", align === "center" ? "mx-auto text-center" : "", className)}>
      <p className={cn("m-0 inline-flex items-center gap-2 text-sm font-semibold text-accent-ink", align === "center" && "justify-center")}>
        <span aria-hidden="true" className="relative inline-block size-3">
          <span className="absolute inset-0 rounded-[4px] border-[1.5px] border-dashed border-primary/70" />
          <span className="absolute top-[3px] left-[3px] size-[9px] rounded-[3px] bg-primary" />
        </span>
        {eyebrow}
      </p>
      <h2 id={`${id}-title`} className="display display-lg mt-4 mb-0">{title}</h2>
      {lead && <p className={cn("mt-5 mb-0 text-lead text-pretty text-ink-2", align === "center" && "mx-auto max-w-[38em]")}>{lead}</p>}
    </Reveal>
  );
}

// Rises into place the first time it scrolls into view. Only a part that starts below the fold waits; with reduced
// motion, no script or no IntersectionObserver, everything is simply there.
export function Reveal({ as = "div", delay = 0, className, style, children }: {
  as?: "div" | "li" | "article"; delay?: number; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setPending(true);
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setPending(false);
      io.disconnect();
    }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return createElement(as, {
    ref,
    "data-pending": pending || undefined,
    className: cn("reveal", className),
    style: delay ? { ...style, transitionDelay: `${delay}ms` } : style,
  }, children);
}

// A card that lifts on hover and, with a mouse, carries a soft light under the pointer. The reveal is on the wrapper
// and the lift on the card, so the two motions don't share one transition. `outer` places it in a grid.
export function Card({ className, outer, children, as = "article", delay }: {
  className?: string; outer?: string; children: ReactNode; as?: "div" | "li" | "article"; delay?: number;
}) {
  return (
    <Reveal as={as} delay={delay} className={cn("flex min-w-0", outer)}>
      <div className={cn("card-lift spotlight relative w-full min-w-0 rounded-panel bg-surface shadow-elevated ring-1 ring-hair", className)}>{children}</div>
    </Reveal>
  );
}

// Sets the pointer's position on the card under it, for the spotlight. One listener for the whole page.
export function trackSpotlight(e: { target: EventTarget | null; clientX: number; clientY: number }) {
  const card = (e.target as Element | null)?.closest?.<HTMLElement>(".spotlight");
  if (!card) return;
  const box = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - box.left}px`);
  card.style.setProperty("--my", `${e.clientY - box.top}px`);
}
