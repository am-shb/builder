// The hero's two meetings on one looping timeline. Each room has its own steps, in ms from its start, then three exit
// steps: the room fades out ("out"), a card names the next meeting ("card"), the card goes ("gap"), and the next
// room's first step fades it in. The header and tabs switch to the next room as the exit starts. Two rooms are never
// on screen together, and the card never shows with either. Pure, so it is tested without a browser.

export type RoomPlan = {
  // When each of the room's steps starts, in ms from the room's start. Step 0 is the empty room fading in.
  times: readonly number[];
  // How long the room plays, from its start to its exit.
  length: number;
  // The room's most telling frame: the still under reduced motion, and where a paused visitor lands.
  still: number;
};

// The exit's steps, in ms from its start: the room has faded out (450 ms) when the card comes in, the card shows for
// a second, and once it has gone the next room starts.
export const EXIT = { card: 450, gap: 1450, next: 1900 } as const;
export const EXIT_MS = EXIT.next;
const PHASES = ["out", "card", "gap"] as const;
export type ExitPhase = (typeof PHASES)[number];

export type Timeline = {
  times: readonly number[];
  loopAt: number;
  // The global step where each room starts, and where its exit starts.
  starts: readonly number[];
  exits: readonly number[];
};

export function buildTimeline(rooms: readonly RoomPlan[]): Timeline {
  const times: number[] = [];
  const starts: number[] = [];
  const exits: number[] = [];
  let at = 0;
  for (const room of rooms) {
    starts.push(times.length);
    for (const t of room.times) times.push(at + t);
    exits.push(times.length);
    const end = at + room.length;
    times.push(end, end + EXIT.card, end + EXIT.gap);
    at = end + EXIT.next;
  }
  return { times, loopAt: at, starts, exits };
}

export type Place = {
  // The room whose steps this is (during an exit, the room leaving).
  room: number;
  // Its step within the room, or null during its exit.
  local: number | null;
  // During an exit, which part of it.
  exit: ExitPhase | null;
  // The room named in the header and the tabs: during an exit, already the next one.
  shown: number;
};

export function locate(tl: Timeline, step: number): Place {
  const n = tl.starts.length;
  for (let r = 0; r < n; r++) {
    if (step >= tl.starts[r]! && step < tl.exits[r]!) return { room: r, local: step - tl.starts[r]!, exit: null, shown: r };
    const k = step - tl.exits[r]!;
    if (k >= 0 && k < PHASES.length) return { room: r, local: null, exit: PHASES[k]!, shown: (r + 1) % n };
  }
  throw new Error(`step ${step} is outside the timeline`);
}

// How far into the shown room's stretch (from the exit before it to its own exit) a step is, and that stretch's
// length: what the active tab's progress bar shows.
export function progress(tl: Timeline, step: number): { elapsed: number; length: number } {
  const n = tl.starts.length;
  const { shown } = locate(tl, step);
  const prevExit = tl.times[tl.exits[(shown - 1 + n) % n]!]!;
  const ownExit = tl.times[tl.exits[shown]!]!;
  const wrap = (ms: number) => ((ms % tl.loopAt) + tl.loopAt) % tl.loopAt;
  return { elapsed: wrap(tl.times[step]! - prevExit), length: wrap(ownExit - prevExit) };
}
