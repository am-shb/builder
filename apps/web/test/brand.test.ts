import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BOT_NAME, PRODUCT_NAME } from "../src/brand.ts";

it("BOT_NAME matches the name the engine gives the bot", () => {
  const engine = readFileSync(join(import.meta.dirname, "../../engine/src/app.ts"), "utf8");
  const m = /const BOT_NAME = "([^"]+)";/.exec(engine);
  expect(m, "apps/engine/src/app.ts should define BOT_NAME").not.toBeNull();
  expect(BOT_NAME).toBe(m![1]);
});

it("both names are set", () => {
  expect(PRODUCT_NAME.trim()).not.toBe("");
  expect(BOT_NAME.trim()).not.toBe("");
});
