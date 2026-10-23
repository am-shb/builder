// A person's final line that plainly picks one of the options on screen ("let's go with B"). Pure and
// deliberately strict: a line that only mentions an option, asks about it or asks to see it is not a pick.
// The conversation loop uses it to resolve a comparison without waiting for the model to notice.

const LABEL = "(a|b|c|bee)";
const LEAD = "(?:(?:ok|okay|yes|yeah|agreed|sure|so|well|i think|i say|we should)\\s+)*";
const PICK_VERB = "(?:(?:i|we)(?:d| would| will)?\\s+)?(?:lets\\s+)?(?:go with|do|pick|choose|vote for|vote|take)";
const PATTERNS = [
  new RegExp(`^${LEAD}(?:option\\s+)?${LABEL}(?:\\s+please)?$`),
  new RegExp(`^${LEAD}${PICK_VERB}\\s+(?:option\\s+)?${LABEL}(?:\\s+(?:please|then|for me))?$`),
  new RegExp(`^${LEAD}(?:option\\s+)?${LABEL}\\s+it is$`),
  new RegExp(`^${LEAD}(?:option\\s+)?${LABEL}\\s+is\\s+(?:actually\\s+|clearly\\s+)?better$`),
];
const LOOKING = /\b(?:show|see|look|view)\b/;
// Hedges, negations and corrections ("B, then A") anywhere in the line: not a pick ("B, definitely not"; a leading "no, B" is also dropped).
const HEDGE = /\b(?:not|no|nope|never|dont|doesnt|isnt|wont|cant|maybe|perhaps|unless|if|unsure|wait|then|instead|rather|scratch that|on second thought|actually(?! better))\b/;
// Another option named in a clause that picks nothing. "a" is left out: it is mostly the article.
const OTHER_LABEL = /\b(?:b|c|bee)\b|\boption a\b/;

// The label a line picks, or null. A line picks when its pick clauses all name one label, no other clause
// names an option, and nothing hedges or negates ("B and A are both fine" and "go with A, no wait, B" pick
// nothing). A line ending in "?" is a question. False negatives are fine; false positives are not.
export function matchSpokenPick(text: string, labels: readonly string[]): "A" | "B" | "C" | null {
  if (/\?[\s.!?]*$/.test(text)) return null;
  const lower = text.toLowerCase().replace(/['\u2019]/g, "");
  if (HEDGE.test(lower)) return null;
  const clauses = lower.split(/[.!?;,:]|\s(?:so)\s/);
  const picked = new Set<string>();
  for (const raw of clauses) {
    const clause = raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!clause) continue;
    if (LOOKING.test(clause)) return null;
    const m = PATTERNS.map((re) => re.exec(clause)).find(Boolean);
    // "do a" / "take a" read as the article; A is only picked by "option A" or a pick phrase that names it.
    if (m && !(m[1] === "a" && /\b(?:do|take) a$/.test(clause))) picked.add(m[1] === "bee" ? "B" : m[1].toUpperCase());
    else if (OTHER_LABEL.test(clause)) return null;
  }
  if (picked.size !== 1) return null;
  const [label] = picked;
  return (label === "A" || label === "B" || label === "C") && labels.includes(label) ? label : null;
}
