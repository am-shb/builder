import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "../src/App.tsx";
import { PRODUCT_NAME } from "../src/brand.ts";

it("the placeholder shows the product name", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(PRODUCT_NAME);
});
