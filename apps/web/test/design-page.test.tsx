import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "./helpers/axe.ts";
import { media } from "./setup.ts";

// The design page reads its query when the module loads, so each case imports it fresh.
async function renderDesign(query: string) {
  history.replaceState(null, "", `/_design${query}`);
  vi.resetModules();
  const { default: DesignPage } = await import("../src/design/DesignPage.tsx");
  render(<DesignPage />);
  await screen.findAllByTestId("design-page");
}

afterEach(() => {
  history.replaceState(null, "", "/");
  delete document.documentElement.dataset.theme;
});

describe("the /_design page", () => {
  for (const [name, query] of [["components", ""], ["sessions screen", "?view=shell"], ["empty state", "?view=shell&empty=1"]] as const) {
    for (const desktop of [false, true]) {
      it(`${name} (${desktop ? "desktop" : "phone"}) has no accessibility violations`, async () => {
        media.matches = desktop;
        await renderDesign(query);
        expect(await axeViolations(document.body)).toEqual([]);
      });
    }
  }

  it("forces a theme from the query", async () => {
    await renderDesign("?theme=dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
