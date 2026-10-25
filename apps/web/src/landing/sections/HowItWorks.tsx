import { useEffect, useRef, useState } from "react";
import { Check, Link as LinkIcon } from "lucide-react";
import { Mark } from "../../components/Mark.tsx";
import { BOT_NAME, STEPS as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";
import { useReducedMotion } from "../useReducedMotion.ts";

// Three steps on one track: a rail down the left on small screens, a line across the top from 1024px. The track is
// dashed and fills in solid as the section scrolls by; each number is a dashed ring until the fill reaches it, then
// a solid one, and its step's picture plays once (landing.css: .journey). With reduced motion, all of it is settled.
export function HowItWorks() {
  const art = [<LinkArt key="link" />, <AdmitArt key="admit" />, <BuildArt key="build" />];
  const { listRef, trackRef, numRefs, reached } = useJourney(C.items.length);
  return (
    <Section id="how-it-works" className="bg-plate/40">
      <SectionHeader id="how-it-works" eyebrow={C.eyebrow} title={C.title} lead={C.lead} />
      <ol ref={listRef} className="journey relative mt-14 mb-0 grid list-none gap-7 p-0 md:mt-16 lg:grid-cols-3 lg:gap-6">
        <span ref={trackRef} aria-hidden="true" className="journey-track pointer-events-none absolute">
          <span className="journey-fill absolute inset-0 bg-primary" />
        </span>
        {C.items.map((step, i) => (
          <li key={step.title} data-reached={i < reached || undefined} className="step relative grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-4 sm:gap-5 lg:flex lg:flex-col lg:items-center lg:gap-7">
            <span ref={(el) => { numRefs.current[i] = el; }} aria-hidden="true" className="step-num relative z-10 grid size-12 max-lg:mt-2.5 place-items-center rounded-full bg-surface text-[17px] font-bold lg:size-14 lg:text-xl">
              <span className="step-ring-dashed absolute inset-0 rounded-full border-2 border-dashed border-[var(--outline)]" />
              <span className="step-ring-solid absolute inset-0 rounded-full border-2 border-primary bg-accent-tint" />
              <span className="relative">{i + 1}</span>
            </span>
            <Reveal delay={i * 120} className="flex min-w-0 lg:w-full lg:flex-1">
              <div className="step-card relative flex w-full min-w-0 flex-col rounded-panel bg-surface p-6 shadow-elevated ring-1 ring-hair sm:p-7">
                <h3 className="display display-md m-0"><span className="sr-only">Step {i + 1}: </span>{step.title}</h3>
                <p className="mt-3 mb-6 text-ink-2 text-pretty">{step.text}</p>
                <div className="mt-auto min-w-0">{art[i]}</div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// Places the track from the first number's center to the last one's, fills it as the list scrolls up the screen, and
// counts the numbers the fill has reached. The count only grows, so a step's picture plays once. At most one update a
// frame; with reduced motion the track is full and every step reached.
function useJourney(count: number) {
  const listRef = useRef<HTMLOListElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const numRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const reduced = useReducedMotion();
  const [reached, setReached] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    const track = trackRef.current;
    if (!list || !track) return;
    let frame = 0;
    let best = 0;
    const update = () => {
      frame = 0;
      const box = list.getBoundingClientRect();
      const centers = numRefs.current.map((el) => {
        const r = el?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top } : { x: 0, y: 0 };
      });
      const first = centers[0] ?? { x: 0, y: 0 };
      const last = centers[centers.length - 1] ?? first;
      const across = Math.abs(last.x - first.x) > Math.abs(last.y - first.y);
      const length = across ? last.x - first.x : last.y - first.y;
      if (across) track.dataset.across = "";
      else delete track.dataset.across;
      track.style.left = `${first.x}px`;
      track.style.top = `${first.y}px`;
      track.style.setProperty("--len", `${Math.max(length, 0)}px`);
      // How far along the fill is, in pixels from the first number. Down the rail it follows a line 62% down the
      // screen; across the top it runs while the numbers' row rises from 85% to 40% of the screen.
      const h = window.innerHeight || 1;
      const along = across ? ((h * 0.85 - (box.top + first.y)) / (h * 0.45)) * length : h * 0.62 - (box.top + first.y);
      const offsets = centers.map((c) => (across ? c.x - first.x : c.y - first.y));
      const now = reduced ? count : offsets.filter((o) => along >= o).length;
      best = Math.max(best, now);
      const fill = reduced || best === count ? 1 : Math.min(Math.max(along / (length || 1), 0), 1);
      track.style.setProperty("--fill", String(fill));
      setReached(best);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("resize", schedule);
    if (!reduced) window.addEventListener("scroll", schedule, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      ro?.disconnect();
    };
  }, [count, reduced]);
  return { listRef, trackRef, numRefs, reached };
}

// Step 1: a link is drawn into the empty field, then "Start session" is pressed.
function LinkArt() {
  return (
    <div aria-hidden="true" className="grid gap-2.5 rounded-plate bg-plate/70 p-4 ring-1 ring-hair">
      <div className="flex min-w-0 items-center gap-2 rounded-field bg-surface px-3 py-2.5 ring-1 ring-[var(--outline)]">
        <LinkIcon className="size-4 shrink-0 text-ink-3" />
        <span className="relative grid min-w-0 flex-1">
          <span className="jr-placeholder col-start-1 row-start-1 truncate text-[13px] text-ink-3">Paste a meeting link</span>
          <span className="jr-type col-start-1 row-start-1 truncate text-[13px] text-ink">meet.google.com/kfp-qzwd-nre</span>
        </span>
      </div>
      <div className="jr-press-1 rounded-full bg-primary py-2 text-center text-[13px] font-semibold text-on-primary">Start session</div>
    </div>
  );
}

// Step 2: "Admit" is pressed, and the bot's ring turns from dashed (waiting) to solid (in the meeting).
function AdmitArt() {
  return (
    <div aria-hidden="true" className="@container/admit">
      <div className="flex items-center gap-3 rounded-plate bg-plate/70 p-4 ring-1 ring-hair @max-[20rem]/admit:flex-wrap">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-surface">
          <span className="jr-wait absolute inset-0 rounded-full border-2 border-dashed border-pending" />
          <span className="jr-in absolute inset-0 rounded-full border-2 border-primary" />
          <Mark className="size-7 rounded-lg" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] leading-snug font-semibold text-ink">{BOT_NAME} wants to join</p>
          <p className="m-0 grid text-[12px] whitespace-nowrap">
            <span className="jr-wait-text col-start-1 row-start-1 text-ink-3">Waiting room</span>
            <span className="jr-in-text col-start-1 row-start-1 inline-flex items-center gap-1 font-medium text-accent-ink"><Check className="size-3" strokeWidth={3} />In the meeting</span>
          </p>
        </div>
        {/* Narrow, it sits under the name at full width, like step 1's button. */}
        <span className="jr-press-2 shrink-0 rounded-full bg-primary px-3 py-1.5 text-center text-[12px] font-semibold text-on-primary @max-[20rem]/admit:basis-full @max-[20rem]/admit:py-2 @max-[20rem]/admit:text-[13px]">Admit</span>
      </div>
    </div>
  );
}

// Step 3: the prototype's parts appear one by one, and the last one settles from dashed to solid.
function BuildArt() {
  return (
    <div aria-hidden="true" className="dot-grid grid grid-cols-2 gap-2 rounded-plate bg-plate/70 p-4 ring-1 ring-hair">
      <div className="jr-part col-span-2 h-6 rounded-lg bg-surface ring-1 ring-hair" />
      <div className="jr-part h-14 rounded-lg bg-surface ring-1 ring-hair" style={{ animationDelay: "380ms" }} />
      <div className="jr-part relative h-14 rounded-lg bg-surface" style={{ animationDelay: "560ms" }}>
        <span className="build-dashed absolute inset-0 rounded-lg border-[1.5px] border-dashed border-pending" />
        <span className="build-solid absolute inset-0 grid place-items-center rounded-lg border-[1.5px] border-primary/70">
          <Check className="size-4 text-primary" strokeWidth={3} />
        </span>
      </div>
    </div>
  );
}
