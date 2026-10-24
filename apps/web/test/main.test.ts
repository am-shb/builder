import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("the app's entry", () => {
  it("turns off zod's eval test, so our CSP (no 'unsafe-eval') reports no violation on any page", async () => {
    // Importing the entry renders nothing; mountApp does.
    await import("../src/app-entry.tsx");
    expect(z.config().jitless).toBe(true);
  });
});
