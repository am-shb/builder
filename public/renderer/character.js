// Builder, the character on the shared screen: the blue robot whose mood always shows what the
// agent is doing. This module builds its DOM and drives it; the stage page's CSS draws it.
// Moods only switch classes and data attributes: each part's pose comes in through a CSS
// transition and its idle motion is a CSS animation, both stepped by the shared 15 fps clock.
// Placement (centre stage vs the dock) is a FLIP between the two CSS-defined spots.
import { animate, logMotion, onFrame } from "@renderer/clock.js";

export const MOODS = ["listening", "thinking", "building", "speaking", "curious", "unsure", "pleased"];
export const MOOD_LABELS = {
  listening: "Listening",
  thinking: "Thinking",
  building: "Building",
  speaking: "Speaking",
  curious: "Curious",
  unsure: "Unsure",
  pleased: "Pleased",
};
export const PLACEMENT_MS = 500;
const LABEL_FADE_MS = 300;
const HEARING_MS = 1800; // rings keep pulsing this long after the last human caption
const MOUTH_REST = 0.3; // open-mouth scale at level 0, so "speaking" reads even between words
const MOUTH_EASE = 0.5; // per 15 fps frame, toward the target level
const EASE = "ease-out";

function part(cls, children = []) {
  const e = document.createElement("div");
  e.className = cls;
  e.append(...children);
  return e;
}

function build() {
  const eye = (side) => part(`bot-eye ${side}`, [part("bot-eyeball"), part(`bot-arc ${side}`)]);
  const face = part("bot-face", [
    eye("l"), eye("r"),
    part("bot-cheek l"), part("bot-cheek r"),
    part("bot-mouth smile"), part("bot-mouth flat"), part("bot-mouth open"), part("bot-mouth grin"),
  ]);
  const q = part("bot-q");
  q.textContent = "?";
  const act = part("bot-act", [
    part("bot-ring one"), part("bot-ring two"),
    part("bot-antenna"), part("bot-bulb"),
    part("bot-dots", [part("bot-dot d1"), part("bot-dot d2"), part("bot-dot d3")]),
    part("bot-wave l"), part("bot-wave r"),
    part("bot-head", [face]),
    q,
  ]);
  const rig = part("bot-rig", [part("bot-pose", [act])]);
  const blocks = part("bot-blocks", [part("bot-block b1"), part("bot-block b2"), part("bot-block b3")]);
  return { bot: part("bot", [rig, blocks]), label: part("bot-label") };
}

/**
 * Builds the character into `el` and returns its controls:
 * - setMood(mood): one of MOODS (anything else is ignored);
 * - setMouth(level): 0..1, the speaking mouth follows it on the clock's frames;
 * - setPlacement("center" | "dock"): moves there over PLACEMENT_MS;
 * - hear(): a participant is speaking; the listening rings pulse for a moment.
 */
export function createCharacter(el) {
  const { bot, label } = build();
  const mouth = bot.querySelector(".bot-mouth.open");
  el.classList.add("builder");
  el.replaceChildren(bot, label);

  let moves = [];
  let hearingTimer = null;
  let mouthTarget = 0;
  let mouthShown = -1;

  function applyMouth() {
    const next = mouthShown < 0 ? mouthTarget : mouthShown + (mouthTarget - mouthShown) * MOUTH_EASE;
    if (Math.abs(next - mouthShown) < 0.01) return;
    mouthShown = Math.abs(next - mouthTarget) < 0.01 ? mouthTarget : next;
    mouth.style.transform = `scaleY(${(MOUTH_REST + (1 - MOUTH_REST) * mouthShown).toFixed(3)})`;
  }
  applyMouth();
  onFrame(applyMouth);

  const character = {
    setMood(mood) {
      if (!MOODS.includes(mood) || el.dataset.mood === mood) return;
      const first = !el.dataset.mood;
      el.dataset.mood = mood;
      label.textContent = MOOD_LABELS[mood];
      if (!first) animate(label, [{ opacity: 0.15 }, { opacity: 1 }], { duration: LABEL_FADE_MS, easing: EASE });
      logMotion({ fn: "setMood", mood });
    },

    setMouth(level) {
      mouthTarget = Math.min(1, Math.max(0, Number(level) || 0));
    },

    setPlacement(placement) {
      if (placement !== "center" && placement !== "dock") return;
      if (el.dataset.placement === placement) return;
      if (!el.dataset.placement) {
        el.dataset.placement = placement; // first draw: no move
        return;
      }
      const parts = [bot, label];
      const from = parts.map((p) => getComputedStyle(p).transform); // mid-move, this is where it is now
      for (const a of moves) a.cancel();
      el.dataset.placement = placement;
      moves = parts.map((p, i) => {
        const to = getComputedStyle(p).transform;
        return animate(p, [{ transform: from[i] }, { transform: to }], { duration: PLACEMENT_MS, easing: EASE });
      });
      logMotion({ fn: "setPlacement", placement });
    },

    hear() {
      el.classList.add("hearing");
      clearTimeout(hearingTimer);
      hearingTimer = setTimeout(() => el.classList.remove("hearing"), HEARING_MS);
    },
  };
  character.setMood("listening");
  return character;
}
