import { expect, it } from "vitest";
import { cn } from "../src/lib/cn.ts";

it("keeps a color next to one of our type sizes, and still merges conflicts", () => {
  expect(cn("text-on-primary", "text-label")).toBe("text-on-primary text-label");
  expect(cn("text-code", "md:text-code-lg", "text-ink-3")).toBe("text-code md:text-code-lg text-ink-3");
  expect(cn("text-label", "text-heading")).toBe("text-heading");
  expect(cn("px-4", "px-6")).toBe("px-6");
});
