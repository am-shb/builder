// Makes the SurrealDB users for SurrealDB Cloud (docs/runbooks/README.md), so no password is ever typed into
// Surrealist. For each user named (engine, api, or both) it makes a random password, hashes it with SurrealDB's own
// crypto::argon2::generate, run in this process, and prints:
// - the SurrealQL to run in Surrealist, which holds only the hashes: namespace builder, the user's database, and the
//   user with the OWNER role on that database only (docs/adr/0011-surrealdb.md);
// - the passwords, once, to paste into Render.
// It prints nothing else and writes no file. Run it in your own terminal, never through an AI agent or a shared
// screen: the output holds the passwords.
//
//   node infra/surrealdb/make-user.ts engine api    first setup
//   node infra/surrealdb/make-user.ts api           rotate one user's password
import { randomBytes } from "node:crypto";
import { connect } from "../../apps/engine/src/db/connect.ts";

const USERS = ["engine", "api"] as const;
type User = (typeof USERS)[number];
// Each app's user lives in the database of the same name, and its password goes on that Render service.
const SERVICE: Record<User, string> = { engine: "builder-engine", api: "builder-api" };

const args = process.argv.slice(2);
const users = [...new Set(args)];
if (!users.length || !users.every((u): u is User => (USERS as readonly string[]).includes(u))) {
  console.error("Usage: node infra/surrealdb/make-user.ts <engine|api> [engine|api]");
  process.exit(2);
}

// SurrealDB in this process, in memory: only its argon2 function is used. Nothing is stored or sent anywhere.
const db = await connect();
const made: { user: User; password: string; hash: string }[] = [];
try {
  for (const user of users) {
    // 256 random bits, hex: only letters and digits, so it pastes cleanly.
    const password = randomBytes(32).toString("hex");
    const [hash] = await db.query<[string]>("RETURN crypto::argon2::generate($password)", { password }).collect();
    if (typeof hash !== "string" || !hash.startsWith("$argon2") || hash.includes("'")) throw new Error("unexpected hash");
    made.push({ user, password, hash });
  }
} finally {
  await db.close();
}

const surql = [
  "BEGIN TRANSACTION;",
  "DEFINE NAMESPACE IF NOT EXISTS builder;",
  "USE NS builder;",
  ...made.flatMap(({ user, hash }) => [
    `DEFINE DATABASE IF NOT EXISTS ${user};`,
    `USE NS builder DB ${user};`,
    `DEFINE USER OVERWRITE ${user} ON DATABASE PASSHASH '${hash}' ROLES OWNER;`,
  ]),
  "COMMIT TRANSACTION;",
];

console.log(`1. Run this in Surrealist, connected as the instance's root user. It holds only password hashes.

${surql.join("\n")}

2. Paste each password into Render as that service's SURREAL_PASS (and SURREAL_USER is the user's name), then clear
   your terminal (scrollback too). The passwords aren't shown again or kept anywhere.
`);
for (const { user, password } of made) console.log(`   ${user} (${SERVICE[user]}): ${password}`);
