import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, type PointerEvent, type ReactNode } from "react";
import { DESKTOP, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { cn } from "../lib/cn.ts";
import { contentClass, Grabber, overlayClass, titleClass } from "./modal-styles.tsx";

// Dragging the sheet's top down this far closes it.
const CLOSE_DISTANCE = 96;

// A bottom sheet on phones, a centered dialog on desktop. Radix traps and restores focus, locks scroll, and closes on
// Escape and on a tap outside. On phones the grabber and title can also be dragged down to close the sheet.
export function ResponsiveModal({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const desktop = useMediaQuery(DESKTOP);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; distance: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (desktop || (e.target as HTMLElement).closest("button")) return;
    drag.current = { start: e.clientY, distance: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !content.current) return;
    drag.current.distance = Math.max(0, e.clientY - drag.current.start);
    content.current.style.transition = "none";
    content.current.style.transform = `translateY(${drag.current.distance}px)`;
  };
  const onPointerUp = () => {
    const done = drag.current;
    drag.current = null;
    if (!done || !content.current) return;
    content.current.style.transition = "transform 200ms ease-out";
    content.current.style.transform = "";
    if (done.distance > CLOSE_DISTANCE) onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content
          ref={content}
          className={contentClass(desktop)}
          {...(description ? {} : { "aria-describedby": undefined })}
          // With a keyboard and mouse, focus the first field: the sheet is opened to fill it in. On touch screens,
          // focus the sheet itself, so the on-screen keyboard doesn't cover it before the person reads it.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
            const field = content.current?.querySelector<HTMLElement>("input, textarea, select");
            (touch || !field ? content.current : field)?.focus();
          }}
        >
          <div
            className={cn(!desktop && "-mx-5 -mt-2 cursor-grab touch-none px-5 pt-2 active:cursor-grabbing")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {!desktop && <Grabber />}
            <div className={cn("flex items-center justify-between gap-4", desktop ? "mb-4" : "mb-3")}>
              <Dialog.Title className={titleClass}>{title}</Dialog.Title>
              <Dialog.Close className="grid size-11 shrink-0 place-items-center rounded-full bg-sunk text-ink transition-colors hover:bg-plate">
                <X aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
                <span className="sr-only">Close</span>
              </Dialog.Close>
            </div>
          </div>
          {description && <Dialog.Description className="-mt-1 mb-4 text-ink-2">{description}</Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
