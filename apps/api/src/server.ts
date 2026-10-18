import { createServer as createHttpServer } from "node:http";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";

export function createServer(): Server {
  return createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

// Run only when started directly, not when a test imports createServer().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  createServer().listen(port, () => {
    console.log(JSON.stringify({ t: Date.now(), msg: "api.listening", port }));
  });
}
