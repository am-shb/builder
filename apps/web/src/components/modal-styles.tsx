import { cn } from "../lib/cn.ts";

// Shared look for dialogs and sheets: a sheet from the bottom on phones, a centered dialog from 768px (ADR 0013).
export const overlayClass = cn(
  "fixed inset-0 z-40 bg-scrim",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0",
  "motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0",
);

export function contentClass(desktop: boolean): string {
  return desktop
    ? cn(
        "fixed top-1/2 left-1/2 z-50 w-[min(460px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 rounded-panel bg-surface p-7 outline-none",
        "shadow-elevated",
        "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-98",
        "motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-98",
        "motion-safe:duration-200",
      )
    : cn(
        "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-sheet bg-surface px-5 pt-2 pb-[calc(24px+env(safe-area-inset-bottom))] outline-none",
        "shadow-elevated",
        "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-bottom",
        "motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:slide-out-to-bottom",
        "motion-safe:duration-250 motion-safe:ease-out",
      );
}

export const titleClass = "m-0 text-heading font-semibold tracking-[-0.02em] text-balance";

export function Grabber() {
  return <span aria-hidden="true" className="mx-auto mb-3 block h-[5px] w-10 rounded-full bg-ink/25" />;
}
