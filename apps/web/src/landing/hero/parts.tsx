import { Check, type LucideIcon } from "lucide-react";
import { BOT_NAME } from "../../brand.ts";
import { Mark } from "../../components/Mark.tsx";
import { cn } from "../../lib/cn.ts";

// The pieces both of the hero's meetings are drawn with: the people and their speech, a part's draft and agreed
// outlines, and the decisions. Invented people only.

export type Status = "hidden" | "draft" | "agreed";
export const pendingOr = (st: Status) => (st === "draft" ? "pending" : st);

type Tone = "a" | "b" | "c" | "d";
const TONES: Record<Tone, string> = {
  a: "bg-s-live-bg text-s-live-ink",
  b: "bg-warn-chip text-warn-ink",
  c: "bg-p-c-bg text-p-c-ink",
  d: "bg-accent-tint text-accent-ink",
};
export const PEOPLE = {
  // The sales review.
  maya: { name: "Maya", initial: "M", tone: "a" },
  jonah: { name: "Jonah", initial: "J", tone: "b" },
  leila: { name: "Leila", initial: "L", tone: "c" },
  // The café app.
  nora: { name: "Nora", initial: "N", tone: "a" },
  theo: { name: "Theo", initial: "T", tone: "c" },
  sana: { name: "Sana", initial: "S", tone: "b" },
  ravi: { name: "Ravi", initial: "R", tone: "d" },
} as const satisfies Record<string, { name: string; initial: string; tone: Tone }>;
export type Who = keyof typeof PEOPLE;
export type Speaker = Who | "bot";
export const toneOf = (who: Who) => TONES[PEOPLE[who].tone];

export type Line = { who: Speaker; text: string };

// The call's people in a row, with a ring on whoever is speaking; the bot's ring is amber while it builds.
export function Avatars({ people, speaking, building }: { people: readonly Who[]; speaking: Speaker | null; building: boolean }) {
  return (
    <div className="flex items-center gap-1.5 @min-[26rem]/scene:gap-2">
      {people.map((id) => (
        <span key={id} className={cn("relative grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold @min-[26rem]/scene:size-9", toneOf(id))}>
          {PEOPLE[id].initial}
          <span className={cn("sc-swap absolute -inset-[3px] rounded-full ring-2 ring-primary", speaking !== id && "opacity-0")} />
        </span>
      ))}
      <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-hair @min-[26rem]/scene:size-9">
        <Mark className="size-6" />
        <span className={cn("sc-swap absolute -inset-[3px] rounded-full ring-2 ring-pending", !building && "opacity-0")} />
        <span className={cn("sc-swap absolute -inset-[3px] rounded-full ring-2 ring-primary", speaking !== "bot" && "opacity-0")} />
      </span>
      <span className="ml-auto pl-1 text-[12px] font-medium whitespace-nowrap text-ink-3">{people.length + 1} in call</span>
    </div>
  );
}

// The meeting's speech, a few lines at a time: `group` is the lines on screen, `said` how many of them have been
// spoken, and the last one spoken is still being typed while `typing`. On a phone each line takes the last one's place.
export function Conversation({ groups, group, said, typing }: { groups: readonly (readonly Line[])[]; group: number; said: number; typing: boolean }) {
  return (
    <div className="grid">
      {groups.map((lines, g) => (
        <div key={g} className="col-start-1 row-start-1 grid content-start gap-2.5">
          {lines.map((line, i) => {
            const on = g === group && i < said;
            return <Bubble key={i} line={line} on={on} typing={i === said - 1 && typing} replaced={on && i < said - 1} />;
          })}
        </div>
      ))}
    </div>
  );
}

function Bubble({ line, on, typing, replaced }: { line: Line; on: boolean; typing: boolean; replaced: boolean }) {
  const person = line.who === "bot" ? null : PEOPLE[line.who];
  const bot = !person;
  return (
    <div
      data-on={on || undefined}
      data-past={replaced || undefined}
      className="sc-fade sc-late flex items-start gap-2 @max-[34rem]/scene:col-start-1 @max-[34rem]/scene:row-start-1"
    >
      {!person
        ? <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-hair"><Mark className="size-[18px]" /></span>
        : <span className={cn("mt-1 grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold", TONES[person.tone])}>{person.initial}</span>}
      <div className={cn("relative max-w-[88%] rounded-2xl rounded-tl-md px-3 py-2 shadow-[0_1px_2px_var(--hair)] ring-1", bot ? "bg-accent-tint ring-primary/25" : "bg-surface ring-hair")}>
        <span className="block text-[11px] font-semibold text-ink-3">{person ? person.name : BOT_NAME}</span>
        <span data-typing={typing || undefined} className="sc-type block text-[13px] leading-snug font-medium text-ink">{line.text}</span>
        <span className={cn("sc-dots absolute bottom-2.5 left-3 flex gap-1", !typing && "opacity-0")}>
          <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
        </span>
      </div>
    </div>
  );
}

// A part's outline, drawn inside a `relative` box. A draft has a dashed amber outline and a "Draft" tag; once agreed
// the outline is solid. The outlines are layered and cross-fade. A soft light flashes around it when it appears and
// when it turns solid, so the eye goes to what just changed.
export function Outline({ status, round = "rounded-xl" }: { status: Status; round?: string }) {
  return (
    <>
      {status !== "hidden" && <span key={status} className={cn("sc-flash", round, status === "draft" ? "is-draft" : "is-agreed")} />}
      <span className={cn("sc-swap pointer-events-none absolute inset-0 border-[1.5px] border-dashed border-pending", round, status === "agreed" && "opacity-0")} />
      <span className={cn("sc-swap pointer-events-none absolute inset-0 border-[1.5px] border-primary/40", round, status !== "agreed" && "opacity-0")} />
      <span data-on={status === "draft" || undefined} className="sc-tag absolute -top-2 right-3 z-10 rounded-[5px] bg-pending px-1.5 py-px text-[10px] leading-tight font-extrabold tracking-[0.04em] text-surface uppercase">
        Draft
      </span>
    </>
  );
}

export function DecisionsHead({ agreed, total }: { agreed: number; total: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-[12px] font-bold text-ink-2">Decisions</span>
      <span className={cn("tabular shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold", agreed === total ? "bg-primary text-on-primary" : "bg-sunk text-ink-2")}>
        {agreed} of {total} agreed
      </span>
    </div>
  );
}

// A decision: pending with a countdown ring (while `counting`), then agreed, naming who agreed. Agreement comes from
// what a person said.
export function Decision({ title, state, agreed, waiting = "Pending", counting = state === "pending" }: {
  title: string; state: "hidden" | "pending" | "agreed"; agreed: string; waiting?: string; counting?: boolean;
}) {
  const done = state === "agreed";
  return (
    <div data-on={state !== "hidden" || undefined} className="sc-fade sc-late relative flex items-center gap-2.5 rounded-xl px-2.5 py-1.5">
      <span className={cn("sc-swap absolute inset-0 rounded-xl border-[1.5px] border-dashed border-pending bg-pending-soft", done && "opacity-0")} />
      <span className={cn("sc-swap absolute inset-0 rounded-xl border-[1.5px] border-primary bg-accent-tint", !done && "opacity-0")} />
      <span className="relative grid size-5 shrink-0 place-items-center">
        <svg viewBox="0 0 20 20" className={cn("sc-swap absolute inset-0 -rotate-90", done && "opacity-0")}>
          <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2.2" className="stroke-pending/25" />
          <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2.2" strokeLinecap="round" pathLength="100"
            className={cn("ring-drain stroke-pending", state === "pending" && counting && "is-running")} />
        </svg>
        <span className={cn("sc-swap absolute inset-0 grid place-items-center rounded-full bg-primary text-on-primary", !done && "scale-50 opacity-0")}>
          <Check className="size-3" strokeWidth={3.5} />
        </span>
      </span>
      <span className="relative grid min-w-0 flex-1">
        <span className="truncate text-[12px] leading-tight font-semibold text-ink">{title}</span>
        <span className="inline-grid overflow-hidden text-[10.5px] leading-snug font-bold whitespace-nowrap">
          <span data-off={done || undefined} className="sc-word col-start-1 row-start-1 truncate text-pending-ink">{waiting}</span>
          <span data-off={!done || undefined} className="sc-word col-start-1 row-start-1 truncate text-accent-ink">{agreed}</span>
        </span>
      </span>
    </div>
  );
}

// A phone's decision tile: dashed and plain before it comes up, dashed amber while pending, solid once agreed.
export function Tile({ label, icon: Icon, status }: { label: string; icon: LucideIcon; status: Status }) {
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

// The space a room's speech and stage sit in: the meeting on the left (on top on a phone), the stage on the right.
export const MEETING_COL = "flex min-w-0 flex-col gap-3 border-hair bg-plate/60 p-3.5 @max-[34rem]/scene:border-b @min-[26rem]/scene:p-4 @min-[34rem]/scene:gap-4 @min-[34rem]/scene:border-r @min-[34rem]/scene:p-5";
export const STAGE_COL = "dot-grid relative flex min-w-0 flex-col gap-3 p-3.5 @min-[26rem]/scene:p-4 @min-[34rem]/scene:p-5";
export const ROOM_GRID = "grid h-full @min-[34rem]/scene:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]";
