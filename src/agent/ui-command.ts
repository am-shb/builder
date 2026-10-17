// Voice commands (spec 8): maps what someone said to a node on the screen the room is looking at,
// and runs it on the stage through the runtime. Resolution is pure; running is in the runner.
import type { Interaction, Prototype, UiNode } from "../ui/schema.ts";
import type { ComparisonView } from "../stage/channel.ts";
import type { SessionRuntime, UiState } from "../session/runtime.ts";
import type { CommandOutcome, UiCommand } from "./conversation-loop.ts";

export type Resolution =
  | { ok: true; nodeId: string; interaction: Interaction }
  | { ok: false; reason: "ambiguous"; candidates: string[] }
  | { ok: false; reason: "not_found" };

/** How long Builder looks unsure after a command it could not run. */
export const UNSURE_MS = 3000;

const TEXT_PROPS = ["label", "text", "placeholder", "title"] as const;
// Words people add around the name of a thing ("the task box", "Settings tab") that are not part of its label.
const FILLER = new Set(["the", "a", "an", "to", "on", "of", "please", "button", "box", "field", "input", "text", "tab", "switch", "toggle", "option", "screen", "page"]);

type Hit = { node: UiNode; text: string };
type Plan = { ok: true; nodeId: string; interactions: Interaction[] } | Exclude<Resolution, { ok: true }>;

const texts = (n: UiNode): string[] =>
  TEXT_PROPS.flatMap((k) => (typeof n.props[k] === "string" && (n.props[k] as string).trim() ? [(n.props[k] as string).trim()] : []));

/** The nodes a person can see now: the shown screen's own, plus anything outside every screen. */
function visibleNodes(proto: Prototype, screen: string): UiNode[] {
  const out: UiNode[] = [];
  const walk = (n: UiNode, inShown: boolean) => {
    if (n.type === "Screen") {
      if (n.id !== screen) return;
      inShown = true;
    } else if (n !== proto.root) out.push(n);
    for (const c of n.children) walk(c, inShown);
  };
  walk(proto.root, false);
  return out;
}

/** Exact match first, then contains, then every meaningful word of the target present. */
function matchText(nodes: UiNode[], target: string): Hit[] {
  const want = target.trim().toLowerCase();
  if (!want) return [];
  const hits = (test: (t: string) => boolean): Hit[] =>
    nodes.flatMap((node) => {
      const text = texts(node).find((t) => test(t.toLowerCase()));
      return text === undefined ? [] : [{ node, text }];
    });
  const exact = hits((t) => t === want);
  if (exact.length) return exact;
  const contains = hits((t) => t.includes(want));
  if (contains.length) return contains;
  const words = want.split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w));
  return words.length ? hits((t) => words.every((w) => t.includes(w))) : [];
}

const describe = (h: Hit) => `${h.text} (${h.node.type})`;

function pick(hits: Hit[], accept: (n: UiNode) => Plan | null): Plan {
  if (hits.length > 1) return { ok: false, reason: "ambiguous", candidates: [...new Set(hits.map(describe))] };
  return (hits.length === 1 && accept(hits[0].node)) || { ok: false, reason: "not_found" };
}

const toggles = (n: UiNode) => n.type === "Toggle" || n.type === "Checkbox";
const plan = (nodeId: string, interactions: Interaction[]): Plan => ({ ok: true, nodeId, interactions });

/** Everything a click on `n` does: its own flip for a switch, then its click handlers. */
function clickInteractions(n: UiNode): Interaction[] {
  return [...(toggles(n) ? [{ kind: "toggle", target: n.id } as const] : []), ...(n.on?.click ?? [])];
}

function planCommand(proto: Prototype, ui: UiState, cmd: UiCommand, comparison: ComparisonView | null): Plan {
  const screen = proto.root.children.some((c) => c.id === ui.screen && c.type === "Screen") ? ui.screen : proto.currentScreen;
  const nodes = visibleNodes(proto, screen);
  switch (cmd.action) {
    case "click":
      return pick(matchText(nodes, cmd.target), (n) => {
        const is = clickInteractions(n);
        return is.length ? plan(n.id, is) : null;
      });
    case "toggle":
      return pick(matchText(nodes, cmd.target), (n) => (toggles(n) ? plan(n.id, [{ kind: "toggle", target: n.id }]) : null));
    case "type": {
      const value = cmd.value;
      if (value === undefined) return { ok: false, reason: "not_found" };
      return pick(matchText(nodes, cmd.target), (n) =>
        n.type === "Input" || n.type === "Select" ? plan(n.id, [{ kind: "setValue", target: n.id, value }, ...(n.on?.change ?? [])]) : null);
    }
    case "navigate": {
      const screens = proto.root.children.filter((c) => c.type === "Screen");
      const byId = screens.filter((s) => s.id.toLowerCase() === cmd.target.trim().toLowerCase());
      const hits = byId.length ? byId.map((node) => ({ node, text: node.id })) : matchText(screens, cmd.target);
      return pick(hits, (s) => {
        // Point at the control that goes there when the screen has one; otherwise the screen itself.
        const via = nodes.find((n) => n.on?.click?.some((i) => i.kind === "navigate" && i.screen === s.id));
        return plan(via?.id ?? s.id, [{ kind: "navigate", screen: s.id }]);
      });
    }
    case "back": {
      const hit = nodes.find((n) => texts(n).some((t) => t.toLowerCase() === "back") && n.on?.click?.some((i) => i.kind === "navigate"));
      return hit ? plan(hit.id, clickInteractions(hit)) : { ok: false, reason: "not_found" };
    }
    case "focus_option": {
      const label = cmd.target.trim().toLowerCase().replace(/^option\s+/, "").toUpperCase();
      if (!comparison?.variants.some((v) => v.label === label)) return { ok: false, reason: "not_found" };
      return plan(`option-${label}`, [{ kind: "open", target: `option-${label}` }]);
    }
  }
}

/**
 * Finds the node a command is about on the screen `uiState` shows (the stage's own screen, which can
 * differ from `proto.currentScreen`) and the interaction to run on it. `comparison` is the open
 * side-by-side view, which `focus_option` needs.
 */
export function resolveCommand(proto: Prototype, uiState: UiState, cmd: UiCommand, comparison: ComparisonView | null = null): Resolution {
  const p = planCommand(proto, uiState, cmd, comparison);
  return p.ok ? { ok: true, nodeId: p.nodeId, interaction: p.interactions[0] } : p;
}

/**
 * The conversation loop's `uiCommand` dependency: resolves against the stage's screen, then sends
 * each interaction to the stage as a command (the pointer glides, then the action runs). A command
 * that cannot be run makes Builder look unsure for 3 s.
 */
export function createUiCommandRunner(deps: { runtime: (sessionId: string) => SessionRuntime; clock: () => number }) {
  return (sessionId: string, cmd: UiCommand): CommandOutcome => {
    const rt = deps.runtime(sessionId);
    const snap = rt.snapshot();
    if (snap.type !== "snapshot") return { ok: false, reason: "unsupported" };
    const p = planCommand(snap.proto, rt.uiState(), cmd, snap.comparison);
    if (!p.ok) {
      rt.updateMoodInputs({ unsureUntil: deps.clock() + UNSURE_MS });
      return p.reason === "ambiguous" ? { ok: false, reason: "ambiguous", candidates: p.candidates } : { ok: false, reason: "not_found" };
    }
    // Picking an option has no effect of its own: the comparison already shows every option.
    if (cmd.action === "focus_option") return { ok: true, visible: false };
    // Only the first interaction gets the pointer cue: the rest name no node, which the stage skips.
    p.interactions.forEach((i, n) => rt.command(n === 0 ? p.nodeId : "", i));
    return { ok: true, visible: true };
  };
}
