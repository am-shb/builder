import { TriangleAlert } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { DESKTOP, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { cn } from "../lib/cn.ts";
import { buttonVariants } from "./Button.tsx";
import { contentClass, Grabber, overlayClass, titleClass } from "./modal-styles.tsx";

// A question that needs an answer before anything is sent ("Start another session for this link?"). Escape and
// Cancel close it; a tap outside doesn't, so it can't be dismissed by accident. The safe answer, Cancel, is the filled
// button and has focus; the risky one is the outline button.
export function ConfirmModal({ open, onOpenChange, title, description, confirmLabel, cancelLabel = "Cancel", onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}) {
  const desktop = useMediaQuery(DESKTOP);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClass} />
        <AlertDialog.Content className={contentClass(desktop)}>
          {!desktop && <Grabber />}
          <span aria-hidden="true" className="mb-4 grid size-11 place-items-center rounded-full bg-warn-chip text-warn-ink">
            <TriangleAlert className="size-5" />
          </span>
          <AlertDialog.Title className={titleClass}>{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 mb-6 text-ink-2">{description}</AlertDialog.Description>
          <div className={cn("flex gap-3", desktop ? "justify-end" : "flex-col-reverse")}>
            <AlertDialog.Cancel className={buttonVariants({ variant: "primary", block: !desktop })}>{cancelLabel}</AlertDialog.Cancel>
            <AlertDialog.Action className={buttonVariants({ variant: "secondary", block: !desktop })} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
