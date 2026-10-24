import { Check, Plus } from "lucide-react";
import { Mark } from "../../components/Mark.tsx";
import { cn } from "../../lib/cn.ts";
import { useInView } from "../useInView.ts";
import { usePageVisible } from "../usePageVisible.ts";
import { useReducedMotion } from "../useReducedMotion.ts";
import { useSceneTimeline } from "./useSceneTimeline.ts";

// The hero's animation: a meeting on the left, the stage on the right. Someone asks for a due date, the prototype gets
// it as a dashed draft and a pending decision, a second person agrees, and both turn solid. Then a new idea starts a
// new pending decision. It is decoration: the hero's text says the same in words (HERO.sceneSummary).
const S = {
  reset: 0, rows: 1, mayaTyping: 2, maya: 3, draft: 4, jonasTyping: 5, jonas: 6, agreed: 7,
  samTyping: 8, sam: 9, overdue: 10, outro: 11,
} as const;
const TIMES = [0, 350, 1300, 2100, 3000, 4700, 5400, 6400, 8800, 9500, 10500, 14400] as const;
const LOOP_AT = 15200;

type Tone = "a" | "b" | "c";
const TONES: Record<Tone, string> = {
  a: "bg-s-live-bg text-s-live-ink",
  b: "bg-warn-chip text-warn-ink",
  c: "bg-p-c-bg text-p-c-ink",
};
const PEOPLE = {
  maya: { name: "Maya", initial: "M", tone: "a" as Tone },
  jonas: { name: "Jonas", initial: "J", tone: "b" as Tone },
  sam: { name: "Sam", initial: "S", tone: "c" as Tone },
};

const TASKS = [
  { title: "Write launch email", due: "Due Fri" },
  { title: "Review pricing page", due: "Due Mon" },
  { title: "Book user interviews", due: "Due Oct 30" },
];

export function HeroScene({ className, paused = false }: { className?: string; paused?: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: "80px" });
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const playing = inView && visible && !paused;
  const step = useSceneTimeline(TIMES, LOOP_AT, { playing, still: reduced ? S.overdue : null });
  const at = (s: number) => step >= s && step < S.outro;
  const due = step >= S.agreed ? "agreed" : step >= S.draft ? "draft" : "hidden";
  const building = (step >= S.draft && step < S.jonasTyping) || step >= S.overdue;
  const speaking = step === S.mayaTyping || step === S.maya ? "maya"
    : step === S.jonasTyping || step === S.jonas ? "jonas"
    : step === S.samTyping || step === S.sam ? "sam" : null;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-reset={step === S.reset || undefined}
      data-paused={!playing || undefined}
      className={cn("scene @container relative select-none", className)}
    >
      {/* Soft light behind the window. */}
      <div className="hero-glow pointer-events-none absolute -inset-x-6 -inset-y-12 -z-10 sm:-inset-x-16 sm:-inset-y-20" />
      <div className="relative overflow-hidden rounded-panel bg-surface shadow-elevated ring-1 ring-hair">
        {/* The window's bar: the meeting, and what the bot is doing. */}
        <div className="flex h-11 items-center gap-3 border-b border-hair px-4 text-[12.5px]">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <span className="size-2 rounded-full bg-live animate-breathe" />
            Live
          </span>
          <span className="tabular truncate text-ink-3">kfp-qzwd-nre</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-sunk py-1 pr-2.5 pl-1 font-semibold text-ink-2">
            <Mark className="size-5 rounded-md" />
            <span className="relative inline-grid">
              <span className={cn("sc-swap col-start-1 row-start-1", building && "opacity-0")}>Listening</span>
              <span className={cn("sc-swap col-start-1 row-start-1", !building && "opacity-0")}>Building</span>
            </span>
          </span>
        </div>

        <div className={cn("sc-body grid @min-[34rem]:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]", step === S.outro && "opacity-0")}>
          {/* The meeting. */}
          <div className="flex min-w-0 flex-col gap-3 border-hair bg-plate/60 p-3.5 @max-[34rem]:border-b @min-[26rem]:p-4 @min-[34rem]:border-r @min-[34rem]:p-5">
            <div className="flex items-center gap-2">
              {Object.entries(PEOPLE).map(([id, p]) => (
                <span key={id} className={cn("relative grid size-8 place-items-center @min-[26rem]:size-9 rounded-full text-[13px] font-bold", TONES[p.tone])}>
                  {p.initial}
                  <span className={cn("sc-swap absolute -inset-[3px] rounded-full ring-2 ring-primary", speaking !== id && "opacity-0")} />
                </span>
              ))}
              <span className="grid size-8 place-items-center rounded-full bg-surface ring-1 ring-hair @min-[26rem]:size-9">
                <Mark className="size-6 rounded-md" />
              </span>
              <span className="ml-auto text-[12px] font-medium whitespace-nowrap text-ink-3">4 in call</span>
            </div>
            <div className="grid gap-2.5 @min-[34rem]:mt-1">
              <Bubble who={PEOPLE.maya} on={at(S.mayaTyping)} typing={step < S.maya} text="Can every task get a due date?" />
              <Bubble who={PEOPLE.jonas} on={at(S.jonasTyping)} typing={step < S.jonas} text="Yes, right under the title." />
              <Bubble who={PEOPLE.sam} on={at(S.samTyping)} typing={step < S.sam} text="Could overdue ones show in red?" />
            </div>
          </div>

          {/* The stage: the prototype, and the decisions beside it. */}
          <div className="dot-grid relative flex min-w-0 flex-col gap-3 p-3.5 @min-[26rem]:p-4 @min-[34rem]:p-5">
            <div className="rounded-plate bg-surface p-3.5 shadow-[0_1px_2px_var(--hair),0_0_0_1px_var(--hair)]">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[15px] font-bold tracking-[-0.01em] text-ink">Tasks</span>
                <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-on-primary">
                  <Plus className="size-3" strokeWidth={2.5} /> Add
                </span>
              </div>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {TASKS.map((task, i) => (
                  <li
                    key={task.title}
                    data-on={at(S.rows) || undefined}
                    style={{ transitionDelay: `${i * 110}ms` }}
                    className={cn("sc-fade relative flex items-start gap-2.5 rounded-xl bg-sunk/70 px-2.5 py-2", i === 2 && "@max-[26rem]:hidden")}
                  >
                    <span className="mt-0.5 size-4 shrink-0 rounded-full ring-[1.5px] ring-ink-3/50" />
                    <span className="grid min-w-0 gap-1">
                      <span className="truncate text-[13px] font-semibold text-ink">{task.title}</span>
                      <DueChip label={task.due} state={step >= S.outro ? "hidden" : due} delay={i * 90}
                        overdue={i === 1 && at(S.overdue)} tag={i === 0 && due === "draft"} />
                    </span>
                    {i === 0 && (
                      <span
                        data-on={(step === S.agreed) || undefined}
                        className="sc-pop absolute top-1/2 right-2 -mt-2.5 rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap text-on-primary shadow-glow"
                      >
                        Added: due date
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-2">
              <Decision title="Due date on every task" state={step >= S.agreed ? "agreed" : at(S.draft) ? "pending" : "hidden"} by="Agreed by Jonas" />
              <Decision title="Overdue tasks in red" state={at(S.overdue) ? "pending" : "hidden"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ who, on, typing, text }: { who: (typeof PEOPLE)[keyof typeof PEOPLE]; on: boolean; typing: boolean; text: string }) {
  return (
    <div data-on={on || undefined} className="sc-fade flex items-start gap-2">
      <span className={cn("mt-1 grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold", TONES[who.tone])}>{who.initial}</span>
      <div className="relative max-w-[88%] rounded-2xl rounded-tl-md bg-surface px-3 py-2 shadow-[0_1px_2px_var(--hair)] ring-1 ring-hair">
        <span className="block text-[11px] font-semibold text-ink-3">{who.name}</span>
        <span className={cn("sc-swap block text-[13px] leading-snug font-medium text-ink", typing && "opacity-0")}>{text}</span>
        <span className={cn("sc-swap absolute bottom-2.5 left-3 flex gap-1", !typing && "opacity-0")}>
          <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
        </span>
      </div>
    </div>
  );
}

// A due date in the prototype: dashed and tagged while it's a draft, solid once the room agreed. The two outlines are
// layered and cross-fade, so only opacity animates.
function DueChip({ label, state, delay, overdue, tag }: { label: string; state: "hidden" | "draft" | "agreed"; delay: number; overdue: boolean; tag: boolean }) {
  return (
    <span data-on={state !== "hidden" || undefined} style={{ transitionDelay: `${delay}ms` }} className="sc-fade relative inline-flex w-fit items-center gap-1.5">
      <span className={cn("relative rounded-md px-1.5 py-px text-[11px] font-semibold transition-colors duration-500", overdue ? "text-danger" : "text-ink-2")}>
        {label}
        <span className={cn("sc-swap absolute -inset-px rounded-md border-[1.5px] border-dashed border-pending", state === "agreed" && !overdue && "opacity-0")} />
        <span className={cn("sc-swap absolute -inset-px rounded-md border-[1.5px] border-primary/70", (state !== "agreed" || overdue) && "opacity-0")} />
      </span>
      {tag && <span className="rounded-[5px] bg-pending px-1 py-px text-[9.5px] leading-tight font-extrabold text-surface">Draft</span>}
    </span>
  );
}

function Decision({ title, state, by }: { title: string; state: "hidden" | "pending" | "agreed"; by?: string }) {
  const agreed = state === "agreed";
  return (
    <div data-on={state !== "hidden" || undefined} className="sc-fade relative flex items-center gap-2.5 rounded-xl px-3 py-2">
      <span className={cn("sc-swap absolute inset-0 rounded-xl border-[1.5px] border-dashed border-pending bg-pending-soft", agreed && "opacity-0")} />
      <span className={cn("sc-swap absolute inset-0 rounded-xl border-[1.5px] border-primary bg-accent-tint", !agreed && "opacity-0")} />
      <span className="relative grid size-5 shrink-0 place-items-center">
        <svg viewBox="0 0 20 20" className={cn("sc-swap absolute inset-0 -rotate-90", agreed && "opacity-0")}>
          <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2.2" className="stroke-pending/25" />
          <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2.2" strokeLinecap="round" pathLength="100"
            className={cn("ring-drain stroke-pending", state === "pending" && "is-running")} />
        </svg>
        <span className={cn("sc-swap absolute inset-0 grid place-items-center rounded-full bg-primary text-on-primary", !agreed && "scale-50 opacity-0")}>
          <Check className="size-3" strokeWidth={3.5} />
        </span>
      </span>
      <span className="relative min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{title}</span>
      <span className="relative inline-grid text-[11px] font-bold whitespace-nowrap">
        <span className={cn("sc-swap col-start-1 row-start-1 text-pending-ink", agreed && "opacity-0")}>Pending</span>
        <span className={cn("sc-swap col-start-1 row-start-1 text-accent-ink", !agreed && "opacity-0")}>
          {by ? <><span className="@max-[24rem]:hidden">{by}</span><span className="@min-[24rem]:hidden">Agreed</span></> : "Agreed"}
        </span>
      </span>
    </div>
  );
}
