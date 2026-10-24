import { ChartColumn, ChartPie, Check, Table, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Mark } from "../../components/Mark.tsx";
import { cn } from "../../lib/cn.ts";
import { useInView } from "../useInView.ts";
import { usePageVisible } from "../usePageVisible.ts";
import { useReducedMotion } from "../useReducedMotion.ts";
import { useAfterLoad } from "./useAfterLoad.ts";
import { useSceneTimeline } from "./useSceneTimeline.ts";

// The hero's animation: a meeting on the left, the prototype on the right. A team builds a sales dashboard in four
// beats. In each, someone asks for one thing, it appears on the prototype as a dashed draft, someone else agrees, and it
// turns solid. Every part shown is one the engine's renderer can build (its ChartCard, Table and StatCard, in the
// dashboard template); its bar chart always marks the last bar, so the best month is also the latest one.
// It is decoration: the hero's text says the same in words (HERO.sceneSummary).
//
// Below 34rem (a phone) the scene is simpler: one speech bubble at a time, only the part being changed, and a row of
// tiles for the decisions.

type Who = "maya" | "jonah" | "leila";
type Tone = "a" | "b" | "c";
const TONES: Record<Tone, string> = {
  a: "bg-s-live-bg text-s-live-ink",
  b: "bg-warn-chip text-warn-ink",
  c: "bg-p-c-bg text-p-c-ink",
};
const PEOPLE: Record<Who, { name: string; initial: string; tone: Tone }> = {
  maya: { name: "Maya", initial: "M", tone: "a" },
  jonah: { name: "Jonah", initial: "J", tone: "b" },
  leila: { name: "Leila", initial: "L", tone: "c" },
};

type Line = { who: Who; text: string };
const BEATS: readonly { ask: Line; reply: Line; decision: string; tile: string; icon: LucideIcon }[] = [
  { ask: { who: "maya", text: "Can we see monthly revenue as a bar chart?" }, reply: { who: "jonah", text: "Yes, that works." }, decision: "Revenue chart", tile: "Revenue", icon: ChartColumn },
  { ask: { who: "jonah", text: "Can we also see revenue by region?" }, reply: { who: "leila", text: "Agreed." }, decision: "Region split", tile: "Regions", icon: ChartPie },
  { ask: { who: "leila", text: "Add a table of our top customers." }, reply: { who: "maya", text: "Looks good." }, decision: "Top customers", tile: "Customers", icon: Table },
  { ask: { who: "jonah", text: "Can we call out our best month?" }, reply: { who: "leila", text: "Yes, put it at the top." }, decision: "Best month", tile: "Best month", icon: Trophy },
];

const REVENUE = [["Jan", 31.2], ["Feb", 34], ["Mar", 38.5], ["Apr", 36.1], ["May", 46.8], ["Jun", 52.4]] as const;
const MAX = Math.max(...REVENUE.map(([, v]) => v));
const REGIONS = [
  { label: "North America", pct: 46, stroke: "stroke-chart-1", key: "bg-chart-1" },
  { label: "Europe", pct: 31, stroke: "stroke-chart-2", key: "bg-chart-2" },
  { label: "Asia Pacific", pct: 23, stroke: "stroke-chart-3", key: "bg-chart-3" },
] as const;
const CUSTOMERS = [["Pinecrest Studio", "$18.4k"], ["Harbor Nine", "$14.9k"], ["Lumen & Vale", "$11.2k"]] as const;

// Each beat's moments, in ms from its start: the last beat's bubbles clear, the question is typed and shown, the draft
// appears, the reply is typed and shown, and the decision is agreed. After the last beat the finished dashboard holds,
// then the outro clears it away, leaving the empty dashboard to start again.
const P = { clear: 0, askTyping: 1, ask: 2, draft: 3, replyTyping: 4, reply: 5, agreed: 6 } as const;
const PHASE_AT = [0, 300, 1200, 2100, 4100, 4800, 5400];
const BEAT_MS = 6900;
const FIRST = 200;
const BEAT_STEPS = BEATS.length * PHASE_AT.length;
const TIMES = [0, ...BEATS.flatMap((_, k) => PHASE_AT.map((t) => FIRST + k * BEAT_MS + t)), 27600, 30400] as const;
const LOOP_AT = 31600;
// The finished dashboard. Also the still frame under reduced motion.
const HOLD = BEAT_STEPS + 1;
const OUTRO = HOLD + 1;
// The first time, the scene opens with the first question already asked.
const OPENING = 1 + P.ask;

type Status = "hidden" | "draft" | "agreed";
const pendingOr = (st: Status) => (st === "draft" ? "pending" : st);

export function HeroScene({ className, paused = false }: { className?: string; paused?: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: "80px" });
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  // The loop starts a moment after the page has loaded, so its first steps don't slow the page down; meanwhile the
  // first question is there to read.
  const started = useAfterLoad(reduced, 1500);
  const playing = inView && visible && !paused;
  const step = useSceneTimeline(TIMES, LOOP_AT, { playing: playing && started, still: reduced ? HOLD : null, start: OPENING });

  const hold = step === HOLD;
  const empty = step === 0 || step === OUTRO;
  const beat = empty ? -1 : hold ? BEATS.length - 1 : Math.floor((step - 1) / PHASE_AT.length);
  const phase = empty ? -1 : hold ? P.agreed : (step - 1) % PHASE_AT.length;
  const status = (i: number): Status =>
    i < beat ? "agreed" : i === beat ? (phase >= P.agreed ? "agreed" : phase >= P.draft ? "draft" : "hidden") : "hidden";
  const agreed = BEATS.filter((_, i) => status(i) === "agreed").length;
  // On a phone only one part shows: the last one, until the next one's draft takes its place. The hold shows the
  // whole dashboard in small.
  const shown = hold ? BEATS.length : phase >= P.draft ? beat : beat - 1;
  const building = phase === P.draft;
  const speaking = phase === P.askTyping || phase === P.ask ? BEATS[beat]!.ask.who
    : phase === P.replyTyping || phase === P.reply ? BEATS[beat]!.reply.who : null;
  const card = (i: number) => ({ status: status(i), past: i !== shown });

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-reset={step === 0 || undefined}
      data-paused={!playing || undefined}
      className={cn("scene @container/scene relative select-none", className)}
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
            <span className="relative inline-grid overflow-hidden">
              <span data-off={building || undefined} className="sc-word col-start-1 row-start-1">Listening</span>
              <span data-off={!building || undefined} className="sc-word col-start-1 row-start-1">Building</span>
            </span>
          </span>
        </div>

        <div className="grid @min-[34rem]/scene:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
          {/* The meeting. */}
          <div className="flex min-w-0 flex-col gap-3 border-hair bg-plate/60 p-3.5 @max-[34rem]/scene:border-b @min-[26rem]/scene:p-4 @min-[34rem]/scene:gap-4 @min-[34rem]/scene:border-r @min-[34rem]/scene:p-5">
            <div className="flex items-center gap-2">
              {(Object.keys(PEOPLE) as Who[]).map((id) => (
                <span key={id} className={cn("relative grid size-8 place-items-center rounded-full text-[13px] font-bold @min-[26rem]/scene:size-9", TONES[PEOPLE[id].tone])}>
                  {PEOPLE[id].initial}
                  <span className={cn("sc-swap absolute -inset-[3px] rounded-full ring-2 ring-primary", speaking !== id && "opacity-0")} />
                </span>
              ))}
              <span className="relative grid size-8 place-items-center rounded-full bg-surface ring-1 ring-hair @min-[26rem]/scene:size-9">
                <Mark className="size-6 rounded-md" />
                <span className={cn("sc-swap absolute -inset-[3px] rounded-full ring-2 ring-pending", !building && "opacity-0")} />
              </span>
              <span className="ml-auto text-[12px] font-medium whitespace-nowrap text-ink-3">4 in call</span>
            </div>

            {/* One beat's two lines at a time. On a phone the reply takes the question's place. */}
            <div className="grid">
              {BEATS.map((b, i) => {
                const on = i === beat;
                return (
                  <div key={b.decision} className="col-start-1 row-start-1 grid content-start gap-2.5">
                    <Bubble line={b.ask} on={on && phase >= P.askTyping} typing={phase < P.ask} replaced={phase >= P.replyTyping} />
                    <Bubble line={b.reply} on={on && phase >= P.replyTyping} typing={phase < P.reply} />
                  </div>
                );
              })}
            </div>

            <div className="@container/dec mt-auto grid grid-cols-[minmax(0,1fr)] gap-1.5 @max-[34rem]/scene:hidden">
              <DecisionsHead agreed={agreed} />
              {BEATS.map((b, i) => (
                <Decision key={b.decision} title={b.decision} state={pendingOr(status(i))} by={PEOPLE[b.reply.who].name} />
              ))}
            </div>
          </div>

          {/* The stage: the prototype being built. */}
          <div className="dot-grid relative flex min-w-0 flex-col gap-3 p-3.5 @min-[26rem]/scene:p-4 @min-[34rem]/scene:p-5">
            <div className="rounded-plate bg-bg p-3 ring-1 ring-hair @min-[26rem]/scene:p-3.5">
              <div className="flex min-h-[46px] items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[15px] font-bold tracking-[-0.01em] text-ink">Sales overview</p>
                  <p className="m-0 truncate text-[11px] font-medium text-ink-3">January to June</p>
                </div>
              </div>

              <div className="relative mt-3 grid gap-2.5 @min-[34rem]/scene:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <p data-on={status(0) === "hidden" || undefined} style={{ transitionDelay: status(0) === "hidden" ? "700ms" : "0ms" }} className="sc-fade pointer-events-none absolute inset-x-0 top-24 m-0 text-center text-[12px] font-medium text-ink-3">
                  Listening for the first idea
                </p>

                {/* The best month, in the dashboard's stats row at the top, as the renderer lays it out. */}
                <ProtoCard {...card(3)} className="@min-[34rem]/scene:col-span-2 @min-[34rem]/scene:row-start-1">
                  <div className="relative flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-tint text-accent-ink"><Trophy className="size-5" /></span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-[11px] font-semibold text-ink-3">Best month</span>
                      <span className="truncate text-[19px] leading-tight font-bold tracking-[-0.01em] text-ink">June · $52.4k</span>
                      <span className="flex items-center gap-1 text-[11.5px] font-bold text-s-live-ink"><TrendingUp className="size-3.5" strokeWidth={2.5} />12% more than May</span>
                    </span>
                  </div>
                </ProtoCard>

                <ProtoCard {...card(0)} title="Monthly revenue" className="@container/chart flex flex-col @min-[34rem]/scene:col-start-1 @min-[34rem]/scene:row-start-2">
                  <div className="relative mt-2.5 grid min-h-[84px] flex-1 grid-cols-6 items-end gap-1.5 @max-[34rem]/scene:min-h-[104px] @min-[12rem]/chart:gap-2.5">
                    {REVENUE.map(([m, v], i) => (
                      <span
                        key={m}
                        className={cn("sc-bar rounded-t-[4px]", i === REVENUE.length - 1 ? "bg-chart-1" : "bg-chart-soft")}
                        style={{ height: `${(v / MAX) * 100}%`, transitionDelay: `${status(0) === "hidden" ? 0 : 420 + i * 90}ms` }}
                      />
                    ))}
                  </div>
                  <div className="relative mt-1.5 grid grid-cols-6 gap-1.5 @min-[12rem]/chart:gap-2.5">
                    {/* A narrow chart labels each month with its first letter, as small charts do. */}
                    {REVENUE.map(([m]) => (
                      <span key={m} className="text-center text-[10px] font-medium text-ink-3">
                        <span className="@min-[12rem]/chart:hidden">{m[0]}</span><span className="hidden @min-[12rem]/chart:inline">{m}</span>
                      </span>
                    ))}
                  </div>
                </ProtoCard>

                <ProtoCard {...card(1)} title="Revenue by region" className="@container/card @min-[34rem]/scene:col-start-2 @min-[34rem]/scene:row-start-2">
                  <div className="relative mt-2.5 flex flex-col items-center gap-2.5 @min-[15rem]/card:flex-row @min-[15rem]/card:gap-4">
                    <Donut on={status(1) !== "hidden"} className="size-[60px] @min-[15rem]/card:size-[76px]" />
                    <ul className="m-0 grid w-full min-w-0 list-none gap-1 p-0">
                      {REGIONS.map((r, i) => (
                        <li key={r.label} className="sc-row flex items-center gap-1.5 text-[10.5px] @min-[15rem]/card:text-[11.5px]" style={{ transitionDelay: `${status(1) === "hidden" ? 0 : 420 + i * 300}ms` }}>
                          <span className={cn("size-2 shrink-0 rounded-[3px]", r.key)} />
                          <span className="min-w-0 flex-1 truncate font-medium text-ink-2">{r.label}</span>
                          <span className="tabular font-bold text-ink">{r.pct}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </ProtoCard>

                <ProtoCard {...card(2)} title="Top customers" className="@min-[34rem]/scene:col-span-2 @min-[34rem]/scene:row-start-3">
                  <div className="relative mt-2 text-[11.5px]">
                    <div className="grid grid-cols-[minmax(0,1fr)_4rem_3rem] gap-2 border-b border-hair pb-1.5 text-[10px] font-semibold text-ink-3">
                      <span>Customer</span><span className="text-right">Revenue</span><span className="text-right">Status</span>
                    </div>
                    {CUSTOMERS.map(([name, amount], i) => (
                      <div
                        key={name}
                        className="sc-row grid grid-cols-[minmax(0,1fr)_4rem_3rem] items-center gap-2 border-b border-hair py-1.5 last:border-b-0 last:pb-0"
                        style={{ transitionDelay: `${status(2) === "hidden" ? 0 : 420 + i * 240}ms` }}
                      >
                        <span className="truncate font-semibold text-ink">{name}</span>
                        <span className="text-right font-medium text-ink-2">{amount}</span>
                        <span className="justify-self-end rounded-full bg-s-live-bg px-1.5 py-px text-[10px] font-bold text-s-live-ink">Paid</span>
                      </div>
                    ))}
                  </div>
                </ProtoCard>


                {/* On a phone the hold shows the whole dashboard in small: what the meeting built. */}
                <ProtoCard status={hold ? "agreed" : "hidden"} past={!hold} title="The dashboard, agreed" className="@min-[34rem]/scene:hidden">
                  <MiniDashboard />
                </ProtoCard>
              </div>
            </div>

            {/* On a phone the decisions are a row of tiles under the prototype. */}
            <div className="grid gap-2 @min-[34rem]/scene:hidden">
              <DecisionsHead agreed={agreed} />
              <div className="grid grid-cols-4 gap-1.5">
                {BEATS.map((b, i) => <Tile key={b.decision} label={b.tile} icon={b.icon} status={status(i)} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ line, on, typing, replaced = false }: { line: Line; on: boolean; typing: boolean; replaced?: boolean }) {
  const who = PEOPLE[line.who];
  return (
    <div
      data-on={on || undefined}
      data-past={(on && replaced) || undefined}
      className="sc-fade sc-late flex items-start gap-2 @max-[34rem]/scene:col-start-1 @max-[34rem]/scene:row-start-1"
    >
      <span className={cn("mt-1 grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold", TONES[who.tone])}>{who.initial}</span>
      <div className="relative max-w-[88%] rounded-2xl rounded-tl-md bg-surface px-3 py-2 shadow-[0_1px_2px_var(--hair)] ring-1 ring-hair">
        <span className="block text-[11px] font-semibold text-ink-3">{who.name}</span>
        <span data-typing={typing || undefined} className="sc-type block text-[13px] leading-snug font-medium text-ink">{line.text}</span>
        <span className={cn("sc-dots absolute bottom-2.5 left-3 flex gap-1", !typing && "opacity-0")}>
          <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
        </span>
      </div>
    </div>
  );
}

// One part of the prototype. A draft has a dashed amber outline and a "Draft" tag; once agreed the outline is solid.
// The outlines are layered and cross-fade. A soft light flashes around it when it appears and when it turns solid, so
// the eye goes to what just changed. On a phone every part sits in one place and only the current one shows.
function ProtoCard({ status, past, title, className, children }: { status: Status; past: boolean; title?: string; className?: string; children: ReactNode }) {
  const on = status !== "hidden";
  return (
    <div
      data-on={on || undefined}
      data-past={past || undefined}
      className={cn(
        "sc-fade sc-late sc-card relative min-w-0 rounded-xl bg-surface p-3 shadow-[0_1px_2px_var(--hair)]",
        "@max-[34rem]/scene:col-start-1 @max-[34rem]/scene:row-start-1 @max-[34rem]/scene:self-center",
        className,
      )}
    >
      {on && <span key={status} className={cn("sc-flash", status === "draft" ? "is-draft" : "is-agreed")} />}
      <span className={cn("sc-swap pointer-events-none absolute inset-0 rounded-xl border-[1.5px] border-dashed border-pending", status === "agreed" && "opacity-0")} />
      <span className={cn("sc-swap pointer-events-none absolute inset-0 rounded-xl border-[1.5px] border-primary/40", status !== "agreed" && "opacity-0")} />
      <span data-on={status === "draft" || undefined} className="sc-tag absolute -top-2 right-3 rounded-[5px] bg-pending px-1.5 py-px text-[10px] leading-tight font-extrabold tracking-[0.04em] text-surface uppercase">
        Draft
      </span>
      {title && <p className="relative m-0 truncate text-[12px] font-bold text-ink">{title}</p>}
      {children}
    </div>
  );
}

// The finished dashboard in small, for a phone: the best month, the two charts and the table's rows, drawn as shapes.
function MiniDashboard() {
  return (
    <div className="relative mt-2.5 grid gap-2">
      <div className="flex items-center gap-2 rounded-lg bg-accent-tint px-2 py-1.5">
        <Trophy className="size-3.5 text-accent-ink" />
        <span className="text-[11.5px] font-bold text-ink">June · $52.4k</span>
        <TrendingUp className="ml-auto size-3.5 text-s-live-ink" strokeWidth={2.5} />
      </div>
      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <div className="flex h-14 items-end gap-1 rounded-lg bg-sunk/60 px-2 pt-2">
          {REVENUE.map(([m, v], i) => (
            <span key={m} className={cn("flex-1 rounded-t-[3px]", i === REVENUE.length - 1 ? "bg-chart-1" : "bg-chart-soft")} style={{ height: `${(v / MAX) * 100}%` }} />
          ))}
        </div>
        <div className="grid h-14 place-items-center rounded-lg bg-sunk/60">
          <Donut on className="size-11" />
        </div>
      </div>
      <div className="grid gap-1 rounded-lg bg-sunk/60 p-2">
        {CUSTOMERS.map(([name], i) => (
          <span key={name} className="flex items-center gap-2">
            <span className="h-1.5 rounded-full bg-ink-3/40" style={{ width: `${62 - i * 12}%` }} />
            <span className="ml-auto h-1.5 w-6 rounded-full bg-s-live-bg" />
          </span>
        ))}
      </div>
    </div>
  );
}

// The donut, drawn the way the renderer draws it: slices are dashes on one circle, starting at the top.
function Donut({ on, className }: { on: boolean; className?: string }) {
  let at = 0;
  return (
    <svg viewBox="0 0 42 42" className={cn("relative shrink-0", className)}>
      <circle cx="21" cy="21" r="15.915" fill="none" strokeWidth="6" className="stroke-sunk" />
      {REGIONS.map((r, i) => {
        const offset = 25 - at;
        at += r.pct;
        return (
          <circle
            key={r.label}
            cx="21" cy="21" r="15.915" fill="none" strokeWidth="6"
            className={cn("sc-slice", r.stroke)}
            strokeDasharray={on ? `${r.pct} ${100 - r.pct}` : "0 100"}
            strokeDashoffset={offset}
            style={{ transitionDelay: `${on ? 420 + i * 300 : 0}ms` }}
          />
        );
      })}
    </svg>
  );
}

function DecisionsHead({ agreed }: { agreed: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-[12px] font-bold text-ink-2">Decisions</span>
      <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold", agreed === BEATS.length ? "bg-primary text-on-primary" : "bg-sunk text-ink-2")}>
        {agreed} of {BEATS.length} agreed
      </span>
    </div>
  );
}

function Decision({ title, state, by }: { title: string; state: "hidden" | "pending" | "agreed"; by: string }) {
  const agreed = state === "agreed";
  return (
    <div data-on={state !== "hidden" || undefined} className="sc-fade sc-late relative flex items-center gap-2.5 rounded-xl px-2.5 py-1.5">
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
      <span className="relative grid min-w-0 flex-1">
        <span className="truncate text-[12px] leading-tight font-semibold text-ink">{title}</span>
        {/* Who agreed: agreement comes from what a person said. */}
        <span className="inline-grid overflow-hidden text-[10.5px] leading-snug font-bold whitespace-nowrap">
          <span data-off={agreed || undefined} className="sc-word col-start-1 row-start-1 truncate text-pending-ink">Pending</span>
          <span data-off={!agreed || undefined} className="sc-word col-start-1 row-start-1 truncate text-accent-ink">Agreed by {by}</span>
        </span>
      </span>
    </div>
  );
}

// A phone's decision tile: dashed and plain before it comes up, dashed amber while pending, solid once agreed.
function Tile({ label, icon: Icon, status }: { label: string; icon: LucideIcon; status: Status }) {
  return (
    <div className="relative flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 pt-2 pb-1.5">
      <span className={cn("sc-swap absolute inset-0 rounded-lg border-[1.5px] border-dashed border-hair", status !== "hidden" && "opacity-0")} />
      <span className={cn("sc-swap absolute inset-0 rounded-lg border-[1.5px] border-dashed border-pending bg-pending-soft", status !== "draft" && "opacity-0")} />
      <span className={cn("sc-swap absolute inset-0 rounded-lg border-[1.5px] border-primary bg-accent-tint", status !== "agreed" && "opacity-0")} />
      <span className="relative grid size-5 place-items-center">
        <Icon className={cn("sc-swap absolute size-4", status === "agreed" && "scale-50 opacity-0", status === "draft" ? "text-pending-ink" : "text-ink-3")} />
        <span className={cn("sc-swap absolute inset-0 grid place-items-center rounded-full bg-primary text-on-primary", status !== "agreed" && "scale-50 opacity-0")}>
          <Check className="size-3" strokeWidth={3.5} />
        </span>
      </span>
      <span className={cn("relative max-w-full truncate text-[10.5px] font-semibold", status === "hidden" ? "text-ink-3" : "text-ink")}>{label}</span>
    </div>
  );
}
