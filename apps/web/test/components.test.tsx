import { render, screen, within } from "@testing-library/react";
import { act } from "react";
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
import { DESKTOP_MOUSE, mediaMatches, PHONE, useScreen } from "./setup.ts";

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

  it("a status named like a built-in property is Unknown too, with the unknown mark", () => {
    for (const status of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const { container, unmount } = render(<StatusPill status={status} />);
      expect(container.textContent, status).toBe("?Unknown");
      expect(container.querySelector("[aria-hidden] span")?.textContent, status).toBe("?");
      unmount();
    }
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
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <ResponsiveModal open={open} onOpenChange={setOpen} title="New session">
        <TextField label="Meeting link" />
      </ResponsiveModal>
    </>
  );
}

describe("the test screen", () => {
  it("answers each query for its own width and pointer", () => {
    useScreen(PHONE);
    expect([mediaMatches("(min-width: 768px)"), mediaMatches("(pointer: coarse)"), mediaMatches("(max-width: 400px)")]).toEqual([false, true, true]);
    useScreen(DESKTOP_MOUSE);
    expect([mediaMatches("(min-width: 768px)"), mediaMatches("(pointer: coarse)"), mediaMatches("(min-width: 768px) and (pointer: fine)")]).toEqual([true, false, true]);
  });
});

describe("ResponsiveModal", () => {
  it("with a mouse, is a named dialog that focuses its field, and Escape closes it", async () => {
    useScreen(DESKTOP_MOUSE);
    render(<ModalHarness />);
    const dialog = screen.getByRole("dialog", { name: "New session" });
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Meeting link"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("on a touch screen, focuses the sheet itself, so the keyboard doesn't cover it before it's read", () => {
    useScreen(PHONE);
    render(<ModalHarness />);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "New session" }));
  });

  it("on close, focus goes back to the button that opened it", async () => {
    useScreen(DESKTOP_MOUSE);
    render(<ModalHarness initial={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
  });

  it("when nothing had focus as it opened, focus goes to the fallback on close", async () => {
    useScreen(DESKTOP_MOUSE);
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button">Fallback</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)}>Open without focus</button>
          <ResponsiveModal open={open} onOpenChange={setOpen} title="New session" returnFocusTo={() => screen.getByRole("button", { name: "Fallback" })}>
            <TextField label="Meeting link" />
          </ResponsiveModal>
        </>
      );
    }
    render(<Harness />);
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => screen.getByRole("button", { name: "Open without focus" }).click());
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fallback" }));
  });

  it("has a labelled close button on phones and on desktop", async () => {
    for (const desktop of [false, true]) {
      useScreen(desktop ? DESKTOP_MOUSE : PHONE);
      const { unmount } = render(<ModalHarness />);
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
      expect(await axeViolations(document.body)).toEqual([]);
      unmount();
    }
  });
});

describe("ConfirmModal", () => {
  it("on Cancel, focus goes back to where it was", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Start session</button>
          <ConfirmModal open={open} onOpenChange={setOpen} title="Start again?" description="Check first." confirmLabel="Start anyway" onConfirm={() => {}} />
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start session" }));
  });

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
