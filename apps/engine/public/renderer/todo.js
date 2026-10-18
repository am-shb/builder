// Builder's to-do list: what it is doing now, what is queued, and what it just finished. It takes
// the place the mood word used to have next to the robot (the robot keeps its moods and colours).
// renderTodo(el, tasks) is called with the whole list every time it changes, and again with the same
// list when the stage re-syncs from a snapshot, so rows are keyed by task id and reused: only a new
// row fades and slides in, and only a removed one fades out (then leaves the DOM).
// Only transform and opacity animate, stepped by the shared 15 fps clock. Task text goes into
// textContent and is never logged.
import { animate } from "@renderer/clock.js";
import { ENTER_MS, EXIT_MS } from "@renderer/motion.js";

export const MAX_ROWS = 4;
const ORDER = { now: 0, queued: 1, done: 2 };
const EASE = "ease-out";

function row(id) {
  const li = document.createElement("li");
  li.dataset.id = id;
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.className = "t";
  li.append(dot, text);
  animate(li, [{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], { duration: ENTER_MS, easing: EASE });
  return li;
}

function leave(li) {
  delete li.dataset.id; // no longer the row for that task, even while it fades
  li.dataset.leaving = "1";
  const gone = () => li.remove();
  animate(li, [{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: EASE }).finished.then(gone, gone);
}

/** Shows `tasks` ({ id, text, state }) as rows in the `<ul>` el: now, then queued, then done. */
export function renderTodo(el, tasks) {
  const sorted = [...tasks].sort((a, b) => ORDER[a.state] - ORDER[b.state]); // stable: keeps the server's order within a state
  const over = sorted.length > MAX_ROWS;
  const shown = over ? sorted.slice(0, MAX_ROWS - 1) : sorted;
  const want = shown.map((t) => ({ id: t.id, cls: t.state, text: t.text }));
  if (over) want.push({ id: "more", cls: "more", text: `+${sorted.length - shown.length} more` });

  const have = new Map();
  for (const li of el.children) if (li.dataset.id !== undefined) have.set(li.dataset.id, li);
  const keep = new Set();
  const rows = want.map((w) => {
    const li = have.get(w.id) ?? row(w.id);
    keep.add(li);
    if (li.className !== w.cls) li.className = w.cls;
    if (li.lastChild.textContent !== w.text) li.lastChild.textContent = w.text;
    return li;
  });
  for (const li of have.values()) if (!keep.has(li)) leave(li);

  // Put the rows in order without moving the ones already in place (rows fading out stay where they are).
  const next = (n) => {
    while (n && n.dataset.leaving) n = n.nextElementSibling;
    return n;
  };
  let cursor = next(el.firstElementChild);
  for (const li of rows) {
    if (li === cursor) cursor = next(cursor.nextElementSibling);
    else el.insertBefore(li, cursor);
  }
}
