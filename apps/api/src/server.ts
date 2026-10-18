import { createServer as createHttpServer } from "node:http";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { createHandler } from "./router.ts";
import type { Log } from "./router.ts";
import { healthRoutes } from "./routes/health.ts";
import { meRoutes } from "./routes/me.ts";
import { sessionReadRoutes } from "./routes/sessions.ts";
import { createClerkAuth } from "./auth/clerk.ts";
import type { Authenticator } from "./auth/clerk.ts";
import { openDb } from "./db/index.ts";
import type { Db } from "./db/index.ts";
import { errorCode } from "./error-code.ts";

// Everything the server needs is passed in, so tests can use fakes. A later step adds the engine client.
// `auth` defaults to Clerk with the config's key. Without `db`, the session routes answer 503 db_unavailable.
export type Deps = { config: Config; log?: Log; auth?: Authenticator; db?: Db | null };

export const jsonLog: Log = (msg, fields) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }));

export function createServer(deps: Deps): Server {
  const log = deps.log ?? jsonLog;
  const auth = deps.auth ?? createClerkAuth(deps.config.clerk, { log });
  const handle = createHandler([...healthRoutes, ...meRoutes(auth), ...sessionReadRoutes(auth, deps.db ?? null)], log);
  return createHttpServer((req, res) => void handle(req, res));
}

// Run only when started directly, not when a test imports createServer().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig(process.env);
  let db: Db;
  try {
    // A server (SurrealDB Cloud) when SURREAL_URL is set, already migrated by `npm run migrate`; otherwise
    // SurrealDB in this process, in SURREAL_PATH, migrated here.
    db = await openDb(config.surreal);
  } catch (err) {
    // The code only: a message can carry connection details.
    jsonLog("db.open_failed", { error: errorCode(err) });
    process.exit(1);
  }
  const server = createServer({ config, db });
  server.listen(config.port, () => {
    jsonLog("api.listening", {
      port: config.port,
      clerk: config.clerk !== null,
      engine: config.engine !== null,
      default_limits: config.defaultLimits !== null,
      db: config.surreal.url ? "server" : "in-process",
    });
  });
  const shutdown = () => {
    server.close();
    db.close().catch((err) => jsonLog("db.close_failed", { error: errorCode(err) })).finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
