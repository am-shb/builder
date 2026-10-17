// Moves downloaded Recall credential JSON files into .env without printing values,
// then deletes the downloads. Usage:
//   node scripts/place-credentials.ts <api-key.json> <verification-secret.json>
import { readFileSync, writeFileSync, existsSync, unlinkSync, copyFileSync, chmodSync } from "node:fs";

const [keyFile, secretFile] = process.argv.slice(2);
if (!keyFile || !secretFile) {
  console.error("usage: node scripts/place-credentials.ts <api-key.json> <verification-secret.json>");
  process.exit(1);
}

function stringLeaves(v: unknown, path = ""): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => stringLeaves(x, path ? `${path}.${k}` : k));
  return [];
}

function pick(file: string, test: (key: string, value: string) => boolean, label: string): string {
  const leaves = stringLeaves(JSON.parse(readFileSync(file, "utf8"))).filter(([k, v]) => test(k, v));
  if (leaves.length !== 1) {
    console.error(`${label}: expected exactly one candidate value in ${file}, found ${leaves.length} (fields: ${leaves.map(([k]) => k).join(", ") || "none"})`);
    process.exit(1);
  }
  return leaves[0][1].trim();
}

const secret = pick(secretFile, (_k, v) => v.startsWith("whsec_"), "verification secret");
const apiKey = pick(keyFile, (k, v) => /key|value|token|secret/i.test(k) && !/preview|name|url|email|_at$/i.test(k) && /^[A-Za-z0-9_-]{32,}$/.test(v), "API key");

const envPath = ".env";
if (!existsSync(envPath)) copyFileSync(".env.example", envPath);
let env = readFileSync(envPath, "utf8");
const set = (name: string, value: string) => {
  const line = `${name}=${value}`;
  env = new RegExp(`^${name}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${name}=.*$`, "m"), () => line) : `${env.trimEnd()}\n${line}\n`;
};
set("RECALL_API_KEY", apiKey);
set("RECALL_WEBHOOK_VERIFICATION_SECRET", secret);
writeFileSync(envPath, env, { mode: 0o600 });
chmodSync(envPath, 0o600);

unlinkSync(keyFile);
unlinkSync(secretFile);
console.log(`RECALL_API_KEY set (${apiKey.length} chars, starts ${apiKey.slice(0, 8)}…)`);
console.log(`RECALL_WEBHOOK_VERIFICATION_SECRET set (whsec_…, ${secret.length} chars)`);
console.log("Deleted both downloaded files. .env is git-ignored and now mode 600.");
