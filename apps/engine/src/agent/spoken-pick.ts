// A person's final line that plainly picks one of the options on screen ("let's go with B"). Pure and
// deliberately strict: a line that only mentions an option, asks about it or asks to see it is not a pick.
// The conversation loop uses it to resolve a comparison without waiting for the model to notice.
//
// Lines come punctuated (the transcript a test or the replay writes) or the way Recall's low-latency transcript
// gives them: lowercase words joined by spaces, no punctuation ("okay i think b is actually better so let's go
// with b"). Both must work, so clauses also split on "because", "but", "so" and "and", and a pick phrase may be
// followed by other words in its clause when those name no option and end in nothing that turns it around.

const LABEL = "(a|b|c|bee)";
const LEAD = "(?:(?:ok|okay|yes|yeah|agreed|sure|so|well|i think|i say|we should|honestly|personally|looking at (?:both|them|the two))\\s+)*";
const PICK_VERB = "(?:(?:i|we)(?:d| would| will)?\\s+)?(?:lets\\s+)?(?:go with|do|pick|choose|vote for|vote|take)";
const REST = "(?:\\s+(.+))?";
// A bare label: the whole clause. Group 1 is "option ", group 2 the label.
const BARE = new RegExp(`^${LEAD}(option\\s+)?${LABEL}(?:\\s+please)?$`);
// Pick phrases, which may be followed by other words (group 3). Groups 1 and 2 as above.
const VERB_PICK = new RegExp(`^${LEAD}${PICK_VERB}\\s+(option\\s+)?${LABEL}${REST}$`);
const NAMED_PICKS = [
  new RegExp(`^${LEAD}(option\\s+)?${LABEL}\\s+it is${REST}$`),
  new RegExp(`^${LEAD}(option\\s+)?${LABEL}\\s+is\\s+(?:actually\\s+|clearly\\s+)?better${REST}$`),
];
const LOOKING = /\b(?:show|see|look|view)\b/;
// Hedges, negations and corrections ("B, then A") anywhere in the line: not a pick ("B, definitely not"; a leading "no, B" is also dropped).
const HEDGE = /\b(?:not|no|nope|never|dont|doesnt|isnt|wont|cant|maybe|perhaps|unless|if|unsure|wait|then|instead|rather|scratch that|on second thought|actually(?! better))\b/;
// Words after a pick phrase that turn it around or make it a question once the "?" is gone ("take B out",
// "go with B, right?", "do B later").
const TRAILING_VETO = /\b(?:out|off|away|down|apart|over|again|later|first|next|right|correct|or|huh|eh)\b/;
// An option named in a clause that picks nothing, or after a pick phrase. "a" is the label only after "option",
// at either end of a clause, or before a verb or another option word; elsewhere it is the article.
const OTHER_LABEL = /\b(?:b|c|bee)\b|\boption a\b|^a\b|\ba$|\ba (?:is|are|was|were|has|had|looks|seems|sounds|it|or|and|then|but|so|vs|versus|over|instead|would|will|wins|please)\b|\b(?:or|than|vs|versus|over) a\b/;
const CLAUSES = /[.!?;,:]|\s(?:because|but|so|and)\s/;

// The label a line picks, or null. A line picks when its pick clauses all name one label, no other clause
// names an option, and nothing hedges or negates ("B and A are both fine" and "go with A, no wait, B" pick
// nothing). A line ending in "?" is a question. A is picked only where it cannot be the article: "option A",
// "A it is", "A is better", or a whole line that is a capital "A" ("let's go with a" may be cut off before
// "bigger card"). False negatives are fine; false positives are not.
export function matchSpokenPick(text: string, labels: readonly string[]): "A" | "B" | "C" | null {
  if (/\?[\s.!?]*$/.test(text)) return null;
  if (/^\s*A[.!]*\s*$/.test(text)) return labels.includes("A") ? "A" : null;
  const lower = text.toLowerCase().replace(/['’]/g, "");
  if (HEDGE.test(lower)) return null;
  const picked = new Set<string>();
  for (const raw of lower.split(CLAUSES)) {
    const clause = raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!clause) continue;
    if (LOOKING.test(clause)) return null;
    const label = pickIn(clause);
    if (label) picked.add(label);
    else if (OTHER_LABEL.test(clause)) return null;
  }
  if (picked.size !== 1) return null;
  const [label] = picked;
  return (label === "A" || label === "B" || label === "C") && labels.includes(label) ? label : null;
}

// The label one clause picks, or null. A bare "a" or "go with a" is the article, so it picks nothing.
function pickIn(clause: string): string | null {
  const named = (m: RegExpExecArray, aNeedsOption: boolean) => {
    if (m[2] === "a" && aNeedsOption && !m[1]) return null;
    const rest = m[3];
    if (rest && (OTHER_LABEL.test(rest) || TRAILING_VETO.test(rest))) return null;
    return m[2] === "bee" ? "B" : m[2].toUpperCase();
  };
  const bare = BARE.exec(clause);
  if (bare) return named(bare, true);
  const verb = VERB_PICK.exec(clause);
  if (verb) return named(verb, true);
  for (const re of NAMED_PICKS) {
    const m = re.exec(clause);
    if (m) return named(m, false);
  }
  return null;
}
