import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/AppShell.tsx";
import { Button } from "../src/components/Button.tsx";
import { ConfirmModal } from "../src/components/ConfirmModal.tsx";
import { EmptyState } from "../src/components/EmptyState.tsx";
import { ResponsiveModal } from "../src/components/ResponsiveModal.tsx";
import { SessionList, SessionRow } from "../src/components/SessionRow.tsx";
import { STATUS_LABELS, StatusPill } from "../src/components/StatusPill.tsx";
import { TextField } from "../src/components/TextField.tsx";
import { PRODUCT_NAME } from "../src/brand.ts";
import { axeViolations } from "./helpers/axe.ts";
import { media } from "./setup.ts";

describe("StatusPill", () => {
  it("shows every api status as its label, in words", () => {
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it("shows a status it doesn't know as Unknown instead of breaking", () => {
    render(<StatusPill status="something_new" />);
    expect(screen.getByText("Unknown")).toBeTruthy();
  });
});

describe("Button", () => {
  it("while busy shows the busy label, says so, and ignores clicks", async () => {
    const onClick = vi.fn();
    render(<Button busy busyLabel="Starting…" onClick={onClick}>Start session</Button>);
    const button = screen.getByRole("button", { name: "Starting…" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    await userEvent.click(button);
    await userEvent.dblClick(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button, so it never submits a form by accident", () => {
    render(<Button>Refresh</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

describe("TextField", () => {
  it("links the label, the hint and the error to the input", () => {
    render(<TextField label="Meeting link" hint="Google Meet, Zoom or Teams." error="Use an https link." />);
    const input = screen.getByLabelText("Meeting link");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["Google Meet, Zoom or Teams.", "Use an https link."]);
  });

  it("is valid with no error", () => {
    render(<TextField label="Meeting link" />);
    expect(screen.getByLabelText("Meeting link").hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("SessionRow", () => {
  it("is one link whose name carries the code and the status", () => {
    render(<SessionList><SessionRow href="/sessions/1" code="kfp-qzwd-nre" status="in_meeting" platform="meet" platformLabel="Google Meet" when="12 min ago" /></SessionList>);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/sessions/1");
    expect(link.textContent).toContain("kfp-qzwd-nre");
    expect(link.textContent).toContain("In the meeting");
    expect(link.textContent).toContain("Google Meet, 12 min ago");
  });
});

function ModalHarness({ initial = true }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <ResponsiveModal open={open} onOpenChange={setOpen} title="New session">
      <TextField label="Meeting link" />
    </ResponsiveModal>
  );
}

describe("ResponsiveModal", () => {
  it("is a named dialog that focuses its field, and Escape closes it", async () => {
    render(<ModalHarness />);
    const dialog = screen.getByRole("dialog", { name: "New session" });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Meeting link"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has a labelled close button on phones and on desktop", async () => {
    for (const desktop of [false, true]) {
      media.matches = desktop;
      const { unmount } = render(<ModalHarness />);
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
      expect(await axeViolations(document.body)).toEqual([]);
      unmount();
    }
  });
});

describe("ConfirmModal", () => {
  it("asks first: an alert dialog whose confirm button runs the action", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal open onOpenChange={() => {}} title="Start another session for this link?" description="Check the meeting first."
      confirmLabel="Start anyway" onConfirm={onConfirm} />);
    const dialog = screen.getByRole("alertdialog", { name: "Start another session for this link?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start anyway" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("EmptyState", () => {
  it("lists the steps in order", () => {
    render(<EmptyState title="Start your first session" description="…" steps={["Paste the link", "Admit it", "Watch"]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Paste the link", "2Admit it", "3Watch"]);
  });
});

describe("AppShell", () => {
  it("has a banner with the product name, a main landmark and a skip link", async () => {
    render(<AppShell actionBar={<Button>New session</Button>}><p>Content</p></AppShell>);
    expect(within(screen.getByRole("banner")).getByText(PRODUCT_NAME)).toBeTruthy();
    expect(screen.getByRole("main").textContent).toBe("Content");
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
