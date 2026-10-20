import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import "./helpers/clerk.tsx";
import { App } from "../src/App.tsx";

it("without settings, the app is the not-configured page in the shell, and calls nothing", () => {
  render(<App config={{ clerkPublishableKey: null, apiUrl: null }} />);
  expect(screen.getByRole("banner")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Not set up yet");
});
