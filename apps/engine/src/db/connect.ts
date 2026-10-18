// Opens the engine's database (docs/adr/0011-surrealdb.md): namespace `builder`, database `engine`.
// - With a URL it's a SurrealDB server: SurrealDB Cloud over wss:// in production, or a local `surreal start` over
//   ws://. The schema there is kept current by `npm run migrate -w @builder/engine` (the pre-deploy command).
// - Without one it's SurrealDB in this process (@surrealdb/node), on a SurrealKV folder for `npm start` and
//   `npm run local`, or in memory for tests and smoke. The store migrates those when it opens them.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Surreal, createRemoteEngines } from "surrealdb";
import type { ConnectOptions } from "surrealdb";
import { createNodeEngines } from "@surrealdb/node";

export const NAMESPACE = "builder";
export const DATABASE = "engine";

export type DbTarget = {
  // SurrealDB server, ws:// or wss://. Absent or null: SurrealDB in this process.
  url?: string | null;
  // Server credentials, required with `url`. Never logged.
  user?: string | null;
  pass?: string | null;
  // `database`: a user defined on builder/engine (SurrealDB Cloud's recommended setup). `root`: a root user, as a
  // local `surreal start --user ... --pass ...` has.
  auth?: "database" | "root";
  // SurrealKV folder for the in-process engine. Absent: in memory, gone when the store closes.
  path?: string;
  // How long to wait for a server before giving up at startup.
  connectTimeoutMs?: number;
  // Another database in the namespace, for tests against a real server (test/helpers), which give each test its own.
  // The apps always use DATABASE.
  database?: string;
};

// Two writes to the same record (or the same unique index entry) at the same time make one of them fail with a
// transaction conflict. Every store query is a single statement, so it's safe to send again, and the store marks
// each one with `.retry()`. The second try sees the first one's write: a duplicate event is ignored, a token that
// is already issued is left alone.
const RETRY = { enabled: true, attempts: 10, retryDelay: 2, retryDelayMax: 100, retryDelayMultiplier: 2, retryDelayJitter: 0.5 };

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

const codeError = (code: string, message: string, cause?: unknown) => Object.assign(new Error(message, { cause }), { code });

export async function connect(target: DbTarget = {}): Promise<Surreal> {
  const db = new Surreal({ engines: { ...createRemoteEngines(), ...createNodeEngines() } });
  const database = target.database ?? DATABASE;
  const base: ConnectOptions = { namespace: NAMESPACE, database, retry: RETRY };
  if (!target.url) {
    let endpoint = "mem://";
    if (target.path) {
      const dir = resolve(target.path);
      mkdirSync(dir, { recursive: true });
      endpoint = `surrealkv://${dir}`;
    }
    await db.connect(endpoint, base);
    return db;
  }

  const url = new URL(target.url);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw codeError("SURREAL_URL_INVALID", "SURREAL_URL must be ws:// or wss://");
  if (!target.user || !target.pass) throw codeError("SURREAL_AUTH_MISSING", "SURREAL_USER and SURREAL_PASS are required with SURREAL_URL");
  const authentication = target.auth === "root"
    ? { username: target.user, password: target.pass }
    : { namespace: NAMESPACE, database, username: target.user, password: target.pass };
  // Once connected, a dropped connection is retried for as long as it takes (the default gives up after five
  // tries). At startup the first connection gets `connectTimeoutMs`, so an unreachable server fails fast.
  const connecting = db.connect(url, { ...base, authentication, reconnect: { attempts: -1, retryDelay: 500, retryDelayMax: 10_000 } });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(codeError("SURREAL_UNREACHABLE", "SurrealDB server did not answer in time")),
      target.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
  });
  try {
    await Promise.race([connecting, timeout]);
    return db;
  } catch (err) {
    connecting.catch(() => {});
    await db.close().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
