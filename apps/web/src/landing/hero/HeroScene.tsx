import { useEffect, useMemo, useState } from "react";
import { Mark } from "../../components/Mark.tsx";
import { cn } from "../../lib/cn.ts";
import { useInView } from "../useInView.ts";
import { usePageVisible } from "../usePageVisible.ts";
import { useReducedMotion } from "../useReducedMotion.ts";
import { CAFE, CAFE_OPENING, CAFE_PEOPLE, CafeRoom, cafeBuilding } from "./CafeRoom.tsx";
import { PEOPLE, toneOf } from "./parts.tsx";
import { SALES, SALES_PEOPLE, SalesRoom, salesBuilding } from "./SalesRoom.tsx";
import { buildTimeline, locate, progress } from "./timeline.ts";
import { useAfterLoad } from "./useAfterLoad.ts";
import { useSceneTimeline } from "./useSceneTimeline.ts";

// The hero's animation: two meetings, one after the other, each with the meeting on the left and the prototype on the
// right. First a team building a café's app disagrees, and the bot lays out both options for the room to pick from
// (CafeRoom); then a team builds a sales dashboard (SalesRoom). The window has a tab per meeting, like a browser's:
// the playing one is raised, in its room's accent color, with a progress bar, and pressing the other switches to it.
// Between rooms, one fades out, a card names the next meeting for a second, and the next fades in, so only one thing
// is ever on screen.
// The meetings are decoration: the hero's text says the same in words (HERO.sceneSummary). The tabs are real buttons.

const ROOMS = [
  { id: "cafe", title: "Café app", code: "tvb-wkqe-jmc", people: CAFE_PEOPLE, plan: CAFE, building: cafeBuilding, Body: CafeRoom },
  { id: "sales", title: "Sales review", code: "kfp-qzwd-nre", people: SALES_PEOPLE, plan: SALES, building: salesBuilding, Body: SalesRoom },
] as const;
const TL = buildTimeline(ROOMS.map((r) => r.plan));
const OPENING = TL.starts[0]! + CAFE_OPENING;
const stillOf = (room: number) => TL.starts[room]! + ROOMS[room]!.plan.still;
// Under reduced motion the scene shows the café's two options: the moment the product is about.
const STILL_ROOM = 0;

export function HeroScene({ paused = false }: { paused?: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: "80px" });
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  // The loop starts a moment after the page has loaded, so its first steps don't slow the page down; meanwhile the
  // first question is there to read.
  const started = useAfterLoad(reduced, 1500);
  // A pill pressed before then starts the loop at once.
  const [kicked, setKicked] = useState(false);
  const playing = inView && visible && !paused;
  const running = playing && (started || kicked);
  const [stillRoom, setStillRoom] = useState(STILL_ROOM);
  const [step, jump] = useSceneTimeline(TL.times, TL.loopAt, { playing: running, still: reduced ? stillOf(stillRoom) : null, start: OPENING });
  const place = locate(TL, step);
  const exiting = place.local === null;

  // A room left early (a pill was pressed) keeps the frame it was on while it fades out.
  const [frozen, setFrozen] = useState<number | null>(null);
  useEffect(() => { if (!exiting) setFrozen(null); }, [exiting]);
  const frameOf = (r: number) => (r !== place.room ? 0 : place.local ?? frozen ?? ROOMS[r]!.plan.times.length - 1);
  const building = !exiting && ROOMS[place.room]!.building(place.local!);

  // The indicator's progress bar is a CSS animation over the shown room, started from where the room is now. It is
  // set again only when the shown room changes or after a jump, so it runs on its own between steps.
  const [jumps, setJumps] = useState(0);
  const bar = useMemo(() => progress(TL, step), [place.shown, jumps]);

  const select = (r: number) => {
    if (reduced) { setStillRoom(r); return; }
    // Paused, the room's telling frame shows at once and stays.
    if (paused) { setJumps((j) => j + 1); jump(stillOf(r)); return; }
    if (r === place.shown || exiting) return;
    setKicked(true);
    setJumps((j) => j + 1);
    setFrozen(place.local);
    jump(TL.exits[place.room]!);
  };

  const room = ROOMS[place.shown]!;
  return (
    <div
      ref={ref}
      data-paused={!playing || undefined}
      data-accent={room.id}
      className="scene @container/scene relative"
    >
      {/* Soft light behind the window. */}
      <div aria-hidden="true" className="hero-glow pointer-events-none absolute -inset-x-6 -inset-y-12 -z-10 sm:-inset-x-16 sm:-inset-y-20" />
      <div className="relative overflow-hidden rounded-panel bg-surface shadow-elevated ring-1 ring-hair">
        {/* A tab per meeting, along the window's top edge. */}
        <div role="group" aria-label="Example meetings" className="flex h-11 items-end gap-1 border-b border-hair bg-plate px-2">
          {ROOMS.map((r, i) => {
            const on = i === place.shown;
            return (
              <button
                key={r.id}
                type="button"
                aria-current={on || undefined}
                onClick={() => select(i)}
                data-accent={r.id}
                className={cn(
                  "sc-tab relative -mb-px flex h-9 min-w-0 items-center gap-2 rounded-t-[10px] px-3 text-[13px] font-semibold whitespace-nowrap",
                  on ? "sc-bar-bg text-ra-ink ring-1 ring-hair [clip-path:inset(-2px_-2px_0_-2px)]" : "text-ink-2 hover:bg-sunk hover:text-ink",
                )}
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ra-line" />
                <span className="truncate">{r.title}</span>
                {on && !reduced && (
                  <span aria-hidden="true" className="absolute inset-x-3 bottom-1 h-[2.5px] overflow-hidden rounded-full bg-ra-line/20">
                    <span
                      key={`${place.shown}-${jumps}`}
                      className="sc-progress block h-full rounded-full bg-ra-line"
                      style={{ animationDuration: `${bar.length}ms`, animationDelay: `${-bar.elapsed}ms`, animationPlayState: running ? "running" : "paused" }}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div aria-hidden="true" className="scene-art select-none">
          {/* The window's bar, in the meeting's accent: which meeting, and what the bot is doing. */}
          <div className="sc-bar-bg flex h-11 items-center gap-3 border-b border-hair px-4 text-[12.5px]">
            <span className="flex shrink-0 items-center gap-2 font-semibold text-ink">
              <span className="size-2 rounded-full bg-live animate-breathe" />
              Live
            </span>
            <span className="relative inline-grid min-w-0 flex-1 overflow-hidden">
              {ROOMS.map((r, i) => (
                <span key={r.id} data-off={i !== place.shown || undefined} className="sc-word col-start-1 row-start-1 truncate">
                  <span className="font-semibold text-ra-ink">Meeting {i + 1} of {ROOMS.length}</span>
                  <span className="tabular text-ink-2 @max-[22rem]/scene:hidden"> · {r.code}</span>
                </span>
              ))}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface/70 py-1 pr-2.5 pl-1 font-semibold text-ink-2 ring-1 ring-hair">
              <Mark className="size-5" />
              <span className="relative inline-grid overflow-hidden">
                <span data-off={building || undefined} className="sc-word col-start-1 row-start-1">Listening</span>
                <span data-off={!building || undefined} className="sc-word col-start-1 row-start-1">Building</span>
              </span>
            </span>
          </div>

          {/* Both rooms in one place, so the window keeps its size; only the playing one is shown. A room that is
              neither playing nor leaving is set back to its start with no motion. Between them, the next meeting's
              card. */}
          <div className="grid">
            {ROOMS.map(({ Body, id }, r) => (
              <div
                key={id}
                data-room={id}
                data-off={r !== place.room || exiting || undefined}
                data-reset={r !== place.room || undefined}
                className="sc-room col-start-1 row-start-1 min-w-0"
              >
                <Body frame={frameOf(r)} />
              </div>
            ))}
            <div className="pointer-events-none col-start-1 row-start-1 grid place-items-center p-4">
              <div data-on={place.exit === "card" || undefined} className="sc-fade sc-intro grid justify-items-center gap-1.5 rounded-2xl bg-surface px-7 pt-5 pb-5 text-center shadow-elevated ring-1 ring-hair">
                <span className="text-[11.5px] font-bold tracking-[0.04em] text-ra-ink uppercase">Meeting {place.shown + 1} of {ROOMS.length}</span>
                <span className="text-[22px] leading-tight font-bold tracking-[-0.01em] text-ink">{room.title}</span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="flex -space-x-1.5">
                    {room.people.map((p) => (
                      <span key={p} className={cn("grid size-6 place-items-center rounded-full text-[10.5px] font-bold ring-2 ring-surface", toneOf(p))}>{PEOPLE[p].initial}</span>
                    ))}
                  </span>
                  <span className="text-[12.5px] font-semibold text-ink-2">{room.people.length} people</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
