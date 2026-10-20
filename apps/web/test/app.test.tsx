import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "../src/App.tsx";
import { PRODUCT_NAME } from "../src/brand.ts";

it("the placeholder home is the app shell with the product name, and calls nothing", () => {
  render(<App />);
  expect(within(screen.getByRole("banner")).getByText(PRODUCT_NAME)).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign-in is coming soon");
});
