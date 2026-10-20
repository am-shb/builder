import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/rate-limit.ts";

test("allows `limit` requests per key in any window, then says how long to wait", () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(limiter.take("user_1"), { ok: true });
    t += 10_000;
  }
  // Requests at 0, 10 and 20 s; at 30 s the first leaves the window at 60 s.
  assert.deepEqual(limiter.take("user_1"), { ok: false, retryAfterSeconds: 30 });
  assert.deepEqual(limiter.take("user_2"), { ok: true }, "each key counts on its own");
  t = 60_001;
  assert.deepEqual(limiter.take("user_1"), { ok: true }, "a sliding window: the oldest has left");
  assert.deepEqual(limiter.take("user_1"), { ok: false, retryAfterSeconds: 10 });
});

test("refused requests don't count, and the wait is never under a second", () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => t });
  assert.equal(limiter.take("k").ok, true);
  t = 999;
  for (let i = 0; i < 5; i++) assert.deepEqual(limiter.take("k"), { ok: false, retryAfterSeconds: 1 });
  t = 1_001;
  assert.equal(limiter.take("k").ok, true);
});

test("a key whose requests have all left the window starts afresh, also after other keys swept it", () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => t });
  limiter.take("old");
  t = 5_000;
  limiter.take("new");
  // "old" was swept: it may go again at once, as if new.
  assert.equal(limiter.take("old").ok, true);
});
