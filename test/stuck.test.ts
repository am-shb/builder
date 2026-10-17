import { test } from "node:test";
import assert from "node:assert/strict";
import { createStuckDetector, SILENCE_MS, CONFLICT_MS, OPEN_QUESTION_MS, STUCK_COOLDOWN_MS } from "../src/agent/stuck.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";

const T0 = 1_700_000_000_000;

function detector() {
  let t = T0;
  const d = createStuckDetector({ clock: () => t });
  return { d, at: (ms: number) => { t = T0 + ms; return t; } };
}

const withConflict = (openedAt: number, status: "open" | "resolved" = "open"): ConsensusDoc => ({
  ...emptyDoc(),
  conflicts: [{
    id: "c1", topic: "Where done tasks go", status, openedAt,
    variants: [
      { label: "A", summary: "Toggle", backers: ["Amir"], batch: { label: "A", ops: [] } },
      { label: "B", summary: "Tab", backers: ["Sara"], batch: { label: "B", ops: [] } },
    ],
  }],
});

const withQuestion = (lastEngagedAt: number): ConsensusDoc => ({
  ...emptyDoc(),
  openQuestions: [{ id: "q1", text: "Do we need accounts?", raisedBy: "Sara", since: lastEngagedAt, lastEngagedAt }],
});

test("thresholds and cooldown are the spec values", () => {
  assert.equal(SILENCE_MS, 20_000);
  assert.equal(CONFLICT_MS, 180_000);
  assert.equal(OPEN_QUESTION_MS, 180_000);
  assert.equal(STUCK_COOLDOWN_MS, 120_000);
});

test("stuck: 20s silence after agent question triggers one stuck turn; cooldown 120s", () => {
  const { d, at } = detector();
  at(0);
  d.onAgentQuestion();
  assert.equal(d.poll(at(19_999)), null);
  assert.deepEqual(d.poll(at(20_000)), { reason: "silence" });
  // One event per silence: it is not repeated while the room stays quiet.
  assert.equal(d.poll(at(21_000)), null);
  assert.equal(d.poll(at(60_000)), null);

  // A second question goes unanswered inside the cooldown: nothing until 120 s after the first event.
  at(30_000);
  d.onAgentQuestion();
  assert.equal(d.poll(at(50_000)), null);
  assert.equal(d.poll(at(139_999)), null);
  assert.deepEqual(d.poll(at(140_000)), { reason: "silence" });
  assert.equal(d.poll(at(141_000)), null);
});

test("a human reply clears the silence; a human question to the room starts it", () => {
  const { d, at } = detector();
  at(0);
  d.onAgentQuestion();
  at(5_000);
  d.onHumanUtterance("I think a list is fine", "Amir");
  assert.equal(d.poll(at(40_000)), null);

  at(50_000);
  d.onHumanUtterance("Should done tasks disappear?", "Sara");
  assert.equal(d.poll(at(69_999)), null);
  assert.deepEqual(d.poll(at(70_000)), { reason: "silence" });

  // A question put to Builder is Builder's to answer, not the room's.
  const other = detector();
  other.at(0);
  other.d.onHumanUtterance("Hey Builder, what do you think?", "Sara");
  assert.equal(other.d.poll(other.at(60_000)), null);
});

test("a conflict open 180 s is stuck once; a resolved one never is", () => {
  const { d, at } = detector();
  d.onDoc(withConflict(T0));
  assert.equal(d.poll(at(179_999)), null);
  assert.deepEqual(d.poll(at(180_000)), { reason: "conflict" });
  assert.equal(d.poll(at(400_000)), null, "the same conflict is nudged once");

  const r = detector();
  r.d.onDoc(withConflict(T0, "resolved"));
  assert.equal(r.d.poll(r.at(400_000)), null);
});

test("an open question unengaged for 180 s is stuck; engaging it again resets the clock", () => {
  const { d, at } = detector();
  d.onDoc(withQuestion(T0));
  assert.equal(d.poll(at(179_999)), null);
  assert.deepEqual(d.poll(at(180_000)), { reason: "open_question" });
  assert.equal(d.poll(at(200_000)), null);

  // Re-engaged at 200 s, then left alone again: due at 380 s (after the cooldown too).
  d.onDoc(withQuestion(T0 + 200_000));
  assert.equal(d.poll(at(379_999)), null);
  assert.deepEqual(d.poll(at(380_000)), { reason: "open_question" });
});

test("only one stuck event per poll, silence first", () => {
  const { d, at } = detector();
  d.onDoc({ ...withConflict(T0), openQuestions: withQuestion(T0).openQuestions });
  at(170_000);
  d.onAgentQuestion();
  assert.deepEqual(d.poll(at(190_000)), { reason: "silence" });
  // Everything else waits out the cooldown.
  assert.equal(d.poll(at(309_999)), null);
  assert.deepEqual(d.poll(at(310_000)), { reason: "conflict" });
  assert.equal(d.poll(at(429_999)), null);
  assert.deepEqual(d.poll(at(430_000)), { reason: "open_question" });
});
