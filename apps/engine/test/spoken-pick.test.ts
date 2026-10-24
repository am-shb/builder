import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSpokenPick } from "../src/agent/spoken-pick.ts";

const labels = ["A", "B"];

// What Recall's low-latency transcript gives: lowercase words joined by spaces, no punctuation.
const toAsr = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

const PICKS_B = [
  "B", "B.", "b", "bee", "Option B.", "Let's go with B", "I'd go with B. Regulars pay the bills.", "let's do b",
  "B it is", "Agreed, B it is. But keep the special below.", "I pick B", "option B please", "B is better",
  "I think b is actually better so let's go with b",
  "Agreed, B it is. But keep the fall special as a smaller card just below it.",
  "I'd go with B. Regulars pay the bills, and one tap is faster in the morning rush.",
];

const NOT_PICKS = [
  "B pushes sales down", "show option B", "can we see B", "what does B look like", "maybe", "be careful",
  "I'd go with C", "A or B?", "go with A, no wait, B",
  "B and A are both fine", "B, but I am not sure", "B but A has the sales", "B, definitely not",
  "we should do a", "we do a", "take a", "B?!", "B.?",
  "B... actually A", "B... hmm A", "B, change that to A", "B, make that A", "B, swap to A", "B, switch to A", "B, I mean A", "B. Make it A.", "B, then A", "B, wait, A", "go with B, on second thought A",
  "let's go with a", "a", "go with a", "I'd go with a", "let's take B out", "go with B, right?", "go with B or the other one",
];

test("lines that plainly pick B", () => {
  for (const text of PICKS_B) assert.equal(matchSpokenPick(text, labels), "B", text);
});

test("lines that only mention, ask about or contradict a pick are not picks", () => {
  for (const text of NOT_PICKS) assert.equal(matchSpokenPick(text, labels), null, text);
});

test("real low-latency transcript lines (lowercase, unpunctuated) that pick B", () => {
  for (const text of [
    "looking at both i'd go with b regulars pay the bills and one tap is faster in the morning rush",
    "agreed b it is but keep the fall special just below it",
    "i'd go with b because regulars pay the bills",
    "okay i think b is actually better so let's go with b",
  ]) assert.equal(matchSpokenPick(text, labels), "B", text);
});

test("every pick still picks the same label once lowercased and stripped of punctuation", () => {
  for (const text of PICKS_B) assert.equal(matchSpokenPick(toAsr(text), labels), "B", toAsr(text));
});

test("every non-pick stays a non-pick once lowercased and stripped of punctuation", () => {
  // Genuinely ambiguous: the question mark was the only thing saying these were not picks, and "b" alone is one.
  const EXCEPTIONS = new Set(["B?!", "B.?"]);
  for (const text of NOT_PICKS) {
    if (EXCEPTIONS.has(text)) continue;
    assert.equal(matchSpokenPick(toAsr(text), labels), null, toAsr(text));
  }
  for (const text of EXCEPTIONS) assert.equal(matchSpokenPick(toAsr(text), labels), "B", "listed exception");
});

test("A is picked only when it cannot be the article", () => {
  for (const text of ["option a", "Option A.", "a it is", "A it is", "a is better", "pick option a", "let's go with option a", "A", "A.", "agreed a it is"]) {
    assert.equal(matchSpokenPick(text, labels), "A", text);
  }
  // Low-latency segments cut sentences at the article: "let's go with a" may be "let's go with a bigger card".
  for (const text of ["let's go with a", "a", "a.", "go with a", "I'd go with a", "i'd go with a", "pick a", "we should do a", "a please"]) {
    assert.equal(matchSpokenPick(text, labels), null, text);
  }
});

test("a pick phrase followed by a phrasal particle or a tag question is not a pick", () => {
  for (const text of ["let's take b out", "i'd take b off the list", "go with b right", "go with b or the other one", "let's do b later", "go with b first", "b it is a smaller card please"]) {
    assert.equal(matchSpokenPick(text, labels), null, text);
  }
});
