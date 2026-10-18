// Stores for tests, all closed when the file's tests end (closing twice is fine). An open in-process SurrealDB
// keeps the process alive, so a test file that left one open would never exit. In memory unless given a path.
import { after } from "node:test";
import { openStore } from "../../src/store.ts";
import type { Store } from "../../src/store.ts";

const open = new Set<Store>();
after(() => Promise.all([...open].map((s) => s.close())));

// The in-process SurrealDB answers from its own threads, so a query isn't done after a fixed number of event-loop
// turns. Every test store counts its calls in flight, and settle() waits for them.
const inFlight = new Set<Promise<unknown>>();

function tracked(store: Store): Store {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(store)) {
    out[name] = typeof value !== "function" ? value : (...args: unknown[]) => {
      const p = Promise.resolve((value as (...a: unknown[]) => unknown)(...args));
      inFlight.add(p);
      p.finally(() => inFlight.delete(p)).catch(() => {});
      return p;
    };
  }
  return out as Store;
}

export async function testStore(opts: Parameters<typeof openStore>[0] = {}): Promise<Store> {
  const store = tracked(await openStore(opts));
  open.add(store);
  return store;
}

/**
 * Lets queued work run: `turns` event-loop turns, then, while any test store call is in flight, waits for it and
 * gives the code after it the same turns. Fake timers don't advance.
 */
export async function settle(turns = 20): Promise<void> {
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < turns; i++) await new Promise<void>((r) => setImmediate(r));
    if (inFlight.size === 0) return;
    await Promise.allSettled([...inFlight]);
  }
  throw new Error("store calls still in flight after 100 rounds");
}
