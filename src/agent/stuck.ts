// Stuck detection for the conversation loop (spec §7). The room is stuck after 20 s of
// silence following a question to the room, a conflict open for 3 minutes, or an open
// question nobody has engaged with for 3 minutes. One event per poll at most, each condition
// is reported once, and after any event nothing more for 2 minutes.
import type { ConsensusDoc } from "../consensus/doc.ts";

export const SILENCE_MS = 20_000;
export const CONFLICT_MS = 180_000;
export const OPEN_QUESTION_MS = 180_000;
export const STUCK_COOLDOWN_MS = 120_000;

/** Someone says Builder's name ("Builder" or "hey Builder"). */
export const ADDRESS_RE = /\b(hey\s+)?builder\b/i;

export type StuckEvent = { reason: "silence" | "conflict" | "open_question" };

export function createStuckDetector(deps: { clock: () => number }) {
  const { clock } = deps;
  // When an unanswered question was put to the room; null once someone speaks or it was reported.
  let questionAt: number | null = null;
  let doc: ConsensusDoc | null = null;
  let cooldownUntil = 0;
  const reported = new Set<string>();

  return {
    onHumanUtterance(text: string, _speaker: string | null) {
      // Any human line breaks the silence. A question to the room (not to Builder) starts it again.
      const t = text.trim();
      questionAt = t.endsWith("?") && !ADDRESS_RE.test(t) ? clock() : null;
    },

    onAgentQuestion() {
      questionAt = clock();
    },

    onDoc(next: ConsensusDoc) {
      doc = next;
    },

    // At most one event per call. An event starts the cooldown.
    poll(now: number): StuckEvent | null {
      if (now < cooldownUntil) return null;
      const report = (reason: StuckEvent["reason"], key?: string): StuckEvent => {
        if (key) reported.add(key);
        cooldownUntil = now + STUCK_COOLDOWN_MS;
        return { reason };
      };
      if (questionAt !== null && now - questionAt >= SILENCE_MS) {
        questionAt = null;
        return report("silence");
      }
      if (!doc) return null;
      const conflict = doc.conflicts.find((c) => c.status === "open" && now - c.openedAt >= CONFLICT_MS && !reported.has(`c:${c.id}`));
      if (conflict) return report("conflict", `c:${conflict.id}`);
      // Keyed by engagement time, so a question engaged again and then dropped is reported again.
      const key = (q: { id: string; lastEngagedAt: number }) => `q:${q.id}:${q.lastEngagedAt}`;
      const question = doc.openQuestions.find((q) => now - q.lastEngagedAt >= OPEN_QUESTION_MS && !reported.has(key(q)));
      if (question) return report("open_question", key(question));
      return null;
    },
  };
}

export type StuckDetector = ReturnType<typeof createStuckDetector>;
