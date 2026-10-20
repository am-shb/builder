// Prints the size of the same screen sent as apply_patches batches in the old and new formats.
// No network. Tokens are estimated as characters / 3.5.
import { readFileSync } from "node:fs";

type Batch = { ops: unknown[] };
const load = (name: string): Batch[] =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8"));

const measure = (batches: Batch[]) => {
  const chars = batches.reduce((n, b) => n + JSON.stringify(b).length, 0);
  return { batches: batches.length, ops: batches.reduce((n, b) => n + b.ops.length, 0), chars, tokens: Math.round(chars / 3.5) };
};

const oldM = measure(load("expense-batches.old.json"));
const newM = measure(load("expense-batches.new.json"));
console.log("| format | batches | ops | JSON chars | est. tokens |");
console.log("|---|---|---|---|---|");
console.log(`| old | ${oldM.batches} | ${oldM.ops} | ${oldM.chars} | ${oldM.tokens} |`);
console.log(`| new | ${newM.batches} | ${newM.ops} | ${newM.chars} | ${newM.tokens} |`);
console.log(`ratio new/old: ${(newM.tokens / oldM.tokens).toFixed(2)}`);
