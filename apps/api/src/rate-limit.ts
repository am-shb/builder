// A sliding-window limit per key, in this process's memory (docs/plans/api-first-slice.md, "Start guards"). The api
// runs as one instance on Render; more instances would each count on their own, so the org caps in the database stay
// the real limit and this one only slows a burst down.

export type RateLimiter = {
  /** Counts one request for `key`. Over the limit: not counted, and how many seconds until one more is allowed. */
  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
};

export function createRateLimiter({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = now();
  return {
    take(key) {
      const t = now();
      // Now and then, forget keys with nothing left in the window, so the map can't grow without bound.
      if (t - lastSweep > windowMs) {
        lastSweep = t;
        for (const [k, times] of hits) if (times.at(-1)! <= t - windowMs) hits.delete(k);
      }
      const recent = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}
