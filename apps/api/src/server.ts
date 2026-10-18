import { createServer as createHttpServer } from "node:http";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { createHandler } from "./router.ts";
import type { Log } from "./router.ts";
import { healthRoutes } from "./routes/health.ts";

// Everything the server needs is passed in, so tests can use fakes. Later steps add the db, auth and engine client.
export type Deps = { config: Config; log?: Log };

export const jsonLog: Log = (msg, fields) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }));

export function createServer(deps: Deps): Server {
  const log = deps.log ?? jsonLog;
  const handle = createHandler([...healthRoutes], log);
  return createHttpServer((req, res) => void handle(req, res));
}

// Run only when started directly, not when a test imports createServer().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig(process.env);
  createServer({ config }).listen(config.port, () => {
    jsonLog("api.listening", {
      port: config.port,
      clerk: config.clerk !== null,
      engine: config.engine !== null,
      default_limits: config.defaultLimits !== null,
    });
  });
}
