// Stores for tests, all closed when the file's tests end (closing twice is fine). An open PGlite keeps a
// timer running, so a test file that left one open would never exit. In memory unless given a data dir.
import { after } from "node:test";
import { openStore } from "../../src/store.ts";
import type { Store } from "../../src/store.ts";

const open = new Set<Store>();
after(() => Promise.all([...open].map((s) => s.close())));

export async function testStore(opts: Parameters<typeof openStore>[0] = {}): Promise<Store> {
  const store = await openStore(opts);
  open.add(store);
  return store;
}
