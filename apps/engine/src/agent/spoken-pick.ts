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

// The label a line picks, or null. A line picks when some clause picks exactly one label and no clause
// picks a different one ("go with A, no wait, B" picks nothing). A line ending in "?" is a question.
export function matchSpokenPick(text: string, labels: readonly string[]): "A" | "B" | "C" | null {
  if (text.trim().endsWith("?")) return null;
  const clauses = text.toLowerCase().replace(/['’]/g, "").split(/[.!?;,:]|\s(?:so|but|and|or)\s/);
  const picked = new Set<string>();
  for (const raw of clauses) {
    const clause = raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!clause || LOOKING.test(clause)) continue;
    for (const re of PATTERNS) {
      const m = re.exec(clause);
      if (!m) continue;
      picked.add(m[1] === "bee" ? "B" : m[1].toUpperCase());
      break;
    }
  }
  if (picked.size !== 1) return null;
  const [label] = picked;
  return (label === "A" || label === "B" || label === "C") && labels.includes(label) ? label : null;
}
