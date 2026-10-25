import { ChartColumn, ChartPie, Table, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import type { RoomPlan } from "./timeline.ts";
import {
  Avatars, Conversation, Decision, DecisionsHead, MEETING_COL, Outline, PEOPLE, ROOM_GRID, STAGE_COL, Tile,
  pendingOr, type Line, type Status, type Who,
} from "./parts.tsx";

// The hero's second meeting: a team builds a sales dashboard in four beats. In each, someone asks for one thing, it
// appears on the prototype as a dashed draft, someone else agrees, and it turns solid. Every part shown is one the
// engine's renderer can build (its ChartCard, Table and StatCard, in the dashboard template); its bar chart always
// marks the last bar, so the best month is also the latest one.
//
// Below 34rem (a phone) the room is simpler: one speech bubble at a time, only the part being changed, and a row of
// tiles for the decisions.

export const SALES_PEOPLE: readonly Who[] = ["maya", "jonah", "leila"];
const BEATS: readonly { ask: Line; reply: Line & { who: Who }; decision: string; tile: string; icon: LucideIcon }[] = [
  { ask: { who: "maya", text: "Can we see monthly revenue as a bar chart?" }, reply: { who: "jonah", text: "Yes, that works." }, decision: "Revenue chart", tile: "Revenue", icon: ChartColumn },
  { ask: { who: "jonah", text: "Can we also see revenue by region?" }, reply: { who: "leila", text: "Agreed." }, decision: "Region split", tile: "Regions", icon: ChartPie },
  { ask: { who: "leila", text: "Add a table of our top customers." }, reply: { who: "maya", text: "Looks good." }, decision: "Top customers", tile: "Customers", icon: Table },
  { ask: { who: "jonah", text: "Can we call out our best month?" }, reply: { who: "leila", text: "Yes, put it at the top." }, decision: "Best month", tile: "Best month", icon: Trophy },
];
const GROUPS = BEATS.map((b) => [b.ask, b.reply]);

const REVENUE = [["Jan", 31.2], ["Feb", 34], ["Mar", 38.5], ["Apr", 36.1], ["May", 46.8], ["Jun", 52.4]] as const;
const MAX = Math.max(...REVENUE.map(([, v]) => v));
const REGIONS = [
  { label: "North America", pct: 46, stroke: "stroke-chart-1", key: "bg-chart-1" },
  { label: "Europe", pct: 31, stroke: "stroke-chart-2", key: "bg-chart-2" },
  { label: "Asia Pacific", pct: 23, stroke: "stroke-chart-3", key: "bg-chart-3" },
] as const;
const CUSTOMERS = [["Pinecrest Studio", "$18.4k"], ["Harbor Nine", "$14.9k"], ["Lumen & Vale", "$11.2k"]] as const;

// Each beat's moments, in ms from its start: the question is typed and shown, the draft appears, the reply is typed
// and shown, and the decision is agreed. Step 0 is the empty room; after the last beat the finished dashboard holds.
const P = { clear: 0, askTyping: 1, ask: 2, draft: 3, replyTyping: 4, reply: 5, agreed: 6 } as const;
const PHASE_AT = [0, 300, 1000, 1800, 3500, 4100, 4600];
const BEAT_MS = 6000;
const FIRST = 200;
// The finished dashboard. Also this room's still frame.
const HOLD = BEATS.length * PHASE_AT.length + 1;
export const SALES: RoomPlan = {
  times: [0, ...BEATS.flatMap((_, k) => PHASE_AT.map((t) => FIRST + k * BEAT_MS + t)), FIRST + BEATS.length * BEAT_MS - 300],
  length: FIRST + BEATS.length * BEAT_MS + 2200,
  still: HOLD,
};

function read(frame: number) {
  const hold = frame === HOLD;
  const empty = frame === 0;
  const beat = empty ? -1 : hold ? BEATS.length - 1 : Math.floor((frame - 1) / PHASE_AT.length);
  const phase = empty ? -1 : hold ? P.agreed : (frame - 1) % PHASE_AT.length;
  return { hold, beat, phase };
}

export function salesBuilding(frame: number) {
  return read(frame).phase === P.draft;
}

export function SalesRoom({ frame }: { frame: number }) {
  const { hold, beat, phase } = read(frame);
  const status = (i: number): Status =>
    i < beat ? "agreed" : i === beat ? (phase >= P.agreed ? "agreed" : phase >= P.draft ? "draft" : "hidden") : "hidden";
  const agreed = BEATS.filter((_, i) => status(i) === "agreed").length;
  // On a phone only one part shows: the last one, until the next one's draft takes its place. The hold shows the
  // whole dashboard in small.
  const shown = hold ? BEATS.length : phase >= P.draft ? beat : beat - 1;
  const building = phase === P.draft;
  const speaking = phase === P.askTyping || phase === P.ask ? BEATS[beat]!.ask.who
    : phase === P.replyTyping || phase === P.reply ? BEATS[beat]!.reply.who : null;
  const said = phase >= P.replyTyping ? 2 : phase >= P.askTyping ? 1 : 0;
  const typing = phase === P.askTyping || phase === P.replyTyping;
  const card = (i: number) => ({ status: status(i), past: i !== shown });

  return (
    <div className={ROOM_GRID}>
      <div className={MEETING_COL}>
        <Avatars people={SALES_PEOPLE} speaking={speaking} building={building} />
        <Conversation groups={GROUPS} group={beat} said={said} typing={typing} />
        <div className="@container/dec mt-auto grid grid-cols-[minmax(0,1fr)] gap-1.5 @max-[34rem]/scene:hidden">
          <DecisionsHead agreed={agreed} total={BEATS.length} />
          {BEATS.map((b, i) => (
            <Decision key={b.decision} title={b.decision} state={pendingOr(status(i))} agreed={`Agreed by ${PEOPLE[b.reply.who].name}`} />
          ))}
        </div>
      </div>

      {/* The stage: the prototype being built. */}
      <div className={STAGE_COL}>
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
          <DecisionsHead agreed={agreed} total={BEATS.length} />
          <div className="grid grid-cols-4 gap-1.5">
            {BEATS.map((b, i) => <Tile key={b.decision} label={b.tile} icon={b.icon} status={status(i)} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// One part of the prototype. On a phone every part sits in one place and only the current one shows.
function ProtoCard({ status, past, title, className, children }: { status: Status; past: boolean; title?: string; className?: string; children: ReactNode }) {
  return (
    <div
      data-on={status !== "hidden" || undefined}
      data-past={past || undefined}
      className={cn(
        "sc-fade sc-late sc-card relative min-w-0 rounded-xl bg-surface p-3 shadow-[0_1px_2px_var(--hair)]",
        "@max-[34rem]/scene:col-start-1 @max-[34rem]/scene:row-start-1 @max-[34rem]/scene:self-center",
        className,
      )}
    >
      <Outline status={status} />
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
