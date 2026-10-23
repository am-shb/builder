import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSpokenPick } from "../src/agent/spoken-pick.ts";

const labels = ["A", "B"];

test("lines that plainly pick B", () => {
  for (const text of [
    "B", "B.", "b", "bee", "Option B.", "Let's go with B", "I'd go with B. Regulars pay the bills.", "let's do b",
    "B it is", "Agreed, B it is. But keep the special below.", "I pick B", "option B please", "B is better",
    "I think b is actually better so let's go with b",
    "Agreed, B it is. But keep the fall special as a smaller card just below it.",
    "I'd go with B. Regulars pay the bills, and one tap is faster in the morning rush.",
  ]) assert.equal(matchSpokenPick(text, labels), "B", text);
});

test("lines that only mention, ask about or contradict a pick are not picks", () => {
  for (const text of [
    "B pushes sales down", "show option B", "can we see B", "what does B look like", "maybe", "be careful",
    "I'd go with C", "A or B?", "go with A, no wait, B",
    "B and A are both fine", "B, but I am not sure", "B but A has the sales", "B, definitely not",
    "we should do a", "we do a", "take a", "B?!", "B.?",
    "B... actually A", "B, then A", "B, wait, A", "go with B, on second thought A",
  ]) assert.equal(matchSpokenPick(text, labels), null, text);
});
