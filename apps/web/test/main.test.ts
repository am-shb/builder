import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("the app's entry", () => {
  it("turns off zod's eval test, so our CSP (no 'unsafe-eval') reports no violation on any page", async () => {
    // No #root in the test page, so it renders nothing.
    await import("../src/main.tsx");
    expect(z.config().jitless).toBe(true);
  });
});
