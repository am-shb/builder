import { Check, Coffee, Columns2, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import type { RoomPlan } from "./timeline.ts";
import {
  Avatars, Conversation, Decision, DecisionsHead, MEETING_COL, Outline, PEOPLE, ROOM_GRID, STAGE_COL, Tile,
  pendingOr, toneOf, type Line, type Speaker, type Status, type Who,
} from "./parts.tsx";

// The hero's first meeting, the Maple Café demo (docs/demo/maple-cafe-script.md) cut to its key moment: the team
// asks for a café's ordering app and agrees on the menu; two people want different things at the top of the home
// screen; the bot shows both side by side as A and B, each with who backs it and its trade-off; someone picks B, the
// bot asks the room, someone agrees, and the decision records who agreed. The room decides, never the bot.
//
// Below 34rem (a phone) it is simpler: one speech bubble at a time, two of the menu's cards, and tiles for the
// decisions.

export const CAFE_PEOPLE: readonly Who[] = ["nora", "theo", "sana", "ravi"];
const GROUPS: readonly (readonly Line[])[] = [
  [
    { who: "nora", text: "Let's build the Maple Café app: today's menu as photo cards with prices." },
    { who: "theo", text: "Looks great. I'm happy with the menu." },
  ],
  [
    { who: "sana", text: "Put our fall special at the top. It has double the margin." },
    { who: "ravi", text: "I disagree. Most orders are repeats. Put Order again at the top." },
  ],
  [
    { who: "theo", text: "Looking at both, I'd go with B." },
    { who: "bot", text: "So: B. Everyone OK?" },
    { who: "nora", text: "Agreed, B it is." },
  ],
];

// The layout of the stage: one phone, both options side by side, or B alone.
type Layout = "one" | "split" | "picked";
type Frame = {
  at: number;
  // The lines on screen (GROUPS[g]), how many are spoken, and whether the last is still being typed.
  g: number; said: number; typing?: boolean;
  building?: boolean;
  menu: Status;
  // The fall special at the top of A, and Order again at the top of B.
  special: Status;
  again: Status;
  layout: Layout;
  // The decision on the top of the home screen; `asking` once the bot has asked the room.
  top: "hidden" | "pending" | "asking" | "agreed";
};

const base = { g: -1, said: 0, menu: "hidden", special: "hidden", again: "hidden", layout: "one", top: "hidden" } as const;
const FRAMES: readonly Frame[] = (() => {
  const out: Frame[] = [];
  let f: Frame = { at: 0, ...base };
  const add = (at: number, change: Partial<Frame>) => {
    f = { ...f, typing: false, building: false, ...change, at };
    out.push(f);
  };
  add(0, {});
  add(300, { g: 0, said: 1, typing: true });
  add(1100, {});
  add(2000, { menu: "draft", building: true });
  add(3600, { said: 2, typing: true });
  add(4200, {});
  add(4700, { menu: "agreed" });
  add(6200, { g: 1, said: 1, typing: true });
  add(7000, {});
  add(7900, { special: "draft", building: true });
  add(9400, { said: 2, typing: true });
  add(10200, {});
  add(11400, { layout: "split", again: "draft", top: "pending", building: true });
  add(12800, {});
  add(15200, { g: 2, said: 1, typing: true });
  add(15900, {});
  add(16700, { layout: "picked", building: true });
  add(17600, { said: 2, typing: true });
  add(18200, { top: "asking" });
  add(19600, { said: 3, typing: true });
  add(20200, {});
  add(20700, { again: "agreed", top: "agreed" });
  return out;
})();
// Both options on screen, the building done: the still frame.
const SPLIT = FRAMES.findIndex((f) => f.layout === "split" && !f.building);
export const CAFE: RoomPlan = { times: FRAMES.map((f) => f.at), length: 24500, still: SPLIT };
// The page opens on this room with its first line already said, so there is something to read before the loop starts.
export const CAFE_OPENING = FRAMES.findIndex((f) => f.g === 0 && f.said === 1 && !f.typing);

export function cafeBuilding(frame: number) {
  return !!FRAMES[frame]!.building;
}

const MENU = [
  { name: "Oat latte", price: "$5.25", food: "latte" },
  { name: "Croissant", price: "$3.75", food: "croissant" },
  { name: "Egg plate", price: "$11.50", food: "plate" },
  { name: "Grain bowl", price: "$12.00", food: "bowl" },
] as const;

export function CafeRoom({ frame }: { frame: number }) {
  const f = FRAMES[frame]!;
  // Whoever's line is being typed, or was typed just before this frame; the bot's own line counts as it speaking.
  const talking = f.typing || (frame > 0 && FRAMES[frame - 1]!.typing);
  const speaking: Speaker | null = talking ? GROUPS[f.g]?.[f.said - 1]?.who ?? null : null;
  const topStatus: Status = f.top === "hidden" ? "hidden" : f.top === "agreed" ? "agreed" : "draft";
  const agreed = (f.menu === "agreed" ? 1 : 0) + (f.top === "agreed" ? 1 : 0);
  const split = f.layout !== "one";

  return (
    <div className={ROOM_GRID}>
      <div className={MEETING_COL}>
        <Avatars people={CAFE_PEOPLE} speaking={speaking} building={!!f.building} />
        <Conversation groups={GROUPS} group={f.g} said={f.said} typing={!!f.typing} />
        <div className="@container/dec mt-auto grid grid-cols-[minmax(0,1fr)] gap-1.5 @max-[34rem]/scene:hidden">
          <DecisionsHead agreed={agreed} total={2} />
          <Decision title="Menu and phone layout" state={pendingOr(f.menu)} agreed={`Agreed by ${PEOPLE.theo.name}`} />
          <Decision
            title="Top of the home screen"
            state={pendingOr(topStatus)}
            waiting="Pending · A or B"
            counting={f.top === "asking"}
            agreed={`B · agreed by ${PEOPLE.theo.name}, ${PEOPLE.nora.name}`}
          />
          <p data-on={f.top === "agreed" || undefined} className="sc-fade sc-late m-0 truncate pl-2.5 text-[10.5px] font-medium text-ink-3">
            Not chosen: A, the fall special on top
          </p>
        </div>
      </div>

      {/* The stage: the app being built, then the two options. */}
      <div className={STAGE_COL}>
        <div className="relative grid flex-1 place-items-center">
          <p data-on={f.menu === "hidden" || undefined} style={{ transitionDelay: f.menu === "hidden" ? "700ms" : "0ms" }} className="sc-fade pointer-events-none absolute inset-x-0 top-1/2 m-0 -translate-y-1/2 text-center text-[12px] font-medium text-ink-3">
            Listening for the first idea
          </p>
          <div data-layout={f.layout} className="sc-ab @container/ab w-full">
            <Option letter="A" by="sana" tradeoff="Higher margin per order" labels={split} off={f.layout === "picked"}>
              <Phone menu={f.menu} top={f.special}>
                <Special />
              </Phone>
            </Option>
            <Option letter="B" by="ravi" tradeoff="Faster for regulars" labels={split} off={!split} pickedBy={f.layout === "picked" ? "theo" : undefined}>
              <Phone menu={split ? "agreed" : "hidden"} top={f.again}>
                <OrderAgain />
              </Phone>
            </Option>
          </div>
        </div>

        {/* On a phone the decisions are tiles under the stage. */}
        <div className="grid gap-2 @min-[34rem]/scene:hidden">
          <DecisionsHead agreed={agreed} total={2} />
          <div className="grid grid-cols-2 gap-1.5">
            <Tile label="Menu" icon={Coffee} status={f.menu} />
            <Tile label="Top: A or B" icon={Columns2} status={topStatus} />
          </div>
        </div>
      </div>
    </div>
  );
}

// One option's column: who backs it and its trade-off, around its phone. A column with no room left (`off`) is
// clipped in from both sides and then hidden, so it folds away. Once someone in the room picks it, it says who
// (`pickedBy`): a person chose it, and the bot only asks the room to confirm.
function Option({ letter, by, tradeoff, labels, off, pickedBy, children }: {
  letter: string; by: Who; tradeoff: string; labels: boolean; off: boolean; pickedBy?: Who; children: ReactNode;
}) {
  return (
    <div data-off={off || undefined} className="sc-opt flex min-w-0 flex-col items-center gap-2 px-1 pt-2.5 pb-1">
      <p data-on={labels || undefined} className="sc-fade m-0 flex max-w-full items-center gap-1.5 text-[11px] font-semibold text-ink-2">
        <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-ink text-[10.5px] font-extrabold text-surface">{letter}</span>
        <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-full text-[9.5px] font-bold", toneOf(by))}>{PEOPLE[by].initial}</span>
        <span className="truncate">Backed by {PEOPLE[by].name}</span>
        {/* Only there once picked, so it takes no room beside the label before then. */}
        {pickedBy && (
          <span className="sc-pop flex shrink-0 items-center gap-1 rounded-full bg-accent-tint py-0.5 pr-2 pl-1 text-[10.5px] font-bold text-accent-ink">
            <Check className="size-3" strokeWidth={3} />
            Picked by {PEOPLE[pickedBy].name}
          </span>
        )}
      </p>
      {children}
      <p data-on={labels || undefined} className="sc-fade m-0 w-[min(11.5rem,calc(50cqi_-_0.75rem))] text-center text-[11.5px] leading-snug font-bold text-ink">
        {tradeoff}
      </p>
    </div>
  );
}

// The app on a phone: its title, what sits at the top, and today's menu as photo cards.
function Phone({ menu, top, children }: { menu: Status; top: Status; children: ReactNode }) {
  return (
    <div data-on={menu !== "hidden" || undefined} className="sc-fade @container/phone relative w-[min(11.5rem,calc(50cqi_-_0.75rem))] shrink-0 rounded-[20px] bg-surface p-2 shadow-[0_1px_3px_var(--hair)] ring-1 ring-hair">
      <Outline status={menu} round="rounded-[20px]" />
      <span className="mx-auto mb-1.5 block h-1 w-8 rounded-full bg-hair" />
      <p className="relative m-0 truncate px-1 text-[14px] leading-tight font-bold tracking-[-0.01em] text-ink">Maple Café</p>
      <div data-on={top !== "hidden" || undefined} className="sc-slot">
        <div className="min-h-0 overflow-hidden">
          <div className="relative mx-1 mt-2.5 mb-0.5">
            <Outline status={top} round="rounded-lg" />
            {children}
          </div>
        </div>
      </div>
      <p className="relative m-0 mt-1.5 px-1 text-[10px] font-semibold text-ink-3">Today's menu</p>
      <div className="relative mt-1 grid grid-cols-2 gap-1.5">
        {MENU.map((m, i) => (
          <div key={m.name} className={cn("min-w-0 rounded-lg bg-bg p-1 ring-1 ring-hair", i >= 2 && "@max-[34rem]/scene:hidden")}>
            <Food kind={m.food} />
            <span className="block truncate px-0.5 pt-1 text-[10px] leading-tight font-semibold text-ink">{m.name}</span>
            <span className="tabular block px-0.5 text-[10px] leading-tight font-bold text-ink-2">{m.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Special() {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-warn-chip p-1.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface/70 text-warn-ink @max-[11rem]/phone:hidden"><Coffee className="size-4" /></span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[9.5px] leading-tight font-bold text-warn-ink">Fall special</span>
        <span className="truncate text-[11px] leading-tight font-bold text-ink">Maple latte</span>
      </span>
      <span className="tabular shrink-0 text-[10.5px] font-bold text-ink">$6.25</span>
    </div>
  );
}

function OrderAgain() {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-accent-tint p-1.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface/70 text-accent-ink @max-[11rem]/phone:hidden"><RotateCcw className="size-4" /></span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[9.5px] leading-tight font-bold text-accent-ink">Order again</span>
        <span className="truncate text-[11px] leading-tight font-bold text-ink">Oat latte</span>
      </span>
      <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] leading-tight font-bold text-on-primary">Reorder</span>
    </div>
  );
}

// The menu's photos, drawn: a latte, a croissant, an egg plate and a grain bowl, in the page's own colors so they
// suit both themes and cost no image requests.
function Food({ kind }: { kind: (typeof MENU)[number]["food"] }) {
  const bg = { latte: "fill-warn-chip", croissant: "fill-pending-soft", plate: "fill-s-live-bg", bowl: "fill-p-c-bg" }[kind];
  return (
    <svg viewBox="0 0 50 30" className="block aspect-[5/3] w-full rounded-md">
      <rect width="50" height="30" className={bg} />
      {kind === "latte" && (
        <g>
          <ellipse cx="25" cy="25" rx="13" ry="2.6" className="fill-warn-ink/25" />
          <path d="M16 11h16v6.5a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" className="fill-surface" />
          <path d="M32 13.2a3.2 3.2 0 1 1 0 6.2" fill="none" strokeWidth="1.8" className="stroke-surface" />
          <ellipse cx="24" cy="11" rx="8" ry="1.8" className="fill-warn-ink/60" />
          <path d="M21 7.5c1-1.4-1-2.4 0-3.8M25 7.5c1-1.4-1-2.4 0-3.8" fill="none" strokeWidth="1" strokeLinecap="round" className="stroke-warn-ink/45" />
        </g>
      )}
      {kind === "croissant" && (
        <g className="fill-pending">
          <ellipse cx="25" cy="24.5" rx="15" ry="2.4" className="fill-pending/20" />
          <ellipse cx="14.5" cy="19" rx="4.2" ry="3" transform="rotate(-35 14.5 19)" />
          <ellipse cx="35.5" cy="19" rx="4.2" ry="3" transform="rotate(35 35.5 19)" />
          <ellipse cx="19.5" cy="15.5" rx="4.6" ry="4.4" className="fill-pending/80" />
          <ellipse cx="30.5" cy="15.5" rx="4.6" ry="4.4" className="fill-pending/80" />
          <ellipse cx="25" cy="13.5" rx="5" ry="5.2" />
        </g>
      )}
      {kind === "plate" && (
        <g>
          <ellipse cx="25" cy="16" rx="16" ry="10" className="fill-surface" />
          <ellipse cx="25" cy="16" rx="12" ry="7" className="fill-bg" />
          <rect x="15" y="12" width="9" height="7" rx="1.6" className="fill-warn-ink/45" />
          <ellipse cx="29.5" cy="15.5" rx="5.5" ry="4" className="fill-surface" />
          <circle cx="29.5" cy="15.5" r="2" className="fill-pending" />
        </g>
      )}
      {kind === "bowl" && (
        <g>
          <circle cx="19" cy="14" r="3.2" className="fill-s-live-ink/70" />
          <circle cx="25" cy="12.5" r="3.4" className="fill-pending/80" />
          <circle cx="31" cy="14" r="3.2" className="fill-chart-2" />
          <circle cx="22" cy="15.5" r="1.4" className="fill-p-c-ink/60" />
          <path d="M11 15h28a14 10 0 0 1-28 0z" className="fill-surface" />
          <path d="M14 18h22" strokeWidth="1" className="stroke-p-c-ink/25" />
        </g>
      )}
    </svg>
  );
}
