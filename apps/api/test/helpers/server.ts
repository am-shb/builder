import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Config } from "../../src/config.ts";

export const testConfig = (over: Partial<Config> = {}): Config => ({
  port: 0,
  clerk: null,
  engine: null,
  defaultLimits: null,
  ...over,
});

/** Starts `server` on a free loopback port, runs `fn` with its base URL, then closes it. */
export async function withServer(server: Server, fn: (base: string) => Promise<void>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
