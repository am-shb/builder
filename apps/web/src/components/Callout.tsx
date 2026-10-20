import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

const TONES = {
  warning: { box: "bg-warn-bg text-warn-ink", Icon: TriangleAlert },
  error: { box: "bg-danger-bg text-danger", Icon: CircleAlert },
  info: { box: "bg-info-bg text-info-ink ring-1 ring-hair ring-inset", Icon: Info },
  success: { box: "bg-s-live-bg/75 text-s-live-ink", Icon: CircleCheck },
} as const;

// A persistent message with our own text. The unknown-outcome warning always uses one (role "alert"), never only a toast.
export function Callout({ tone = "warning", title, children, action, role, onDismiss, className }: {
  tone?: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
  // A close button, for messages the person can put away.
  onDismiss?: (() => void) | undefined;
  className?: string;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div role={role} className={cn("flex gap-3.5 rounded-plate px-5 py-4", box, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      {/* A code in the text (an engine's error code) may be one long word: it wraps instead of widening the page. */}
      <div className="min-w-0 flex-1 wrap-anywhere">
        <p className="m-0 font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-ink">{children}</div>}
        {/* Buttons sit on the surface color, so they read clearly on any tint. */}
        {action && <div className="mt-3 flex flex-wrap gap-2 [&>*]:bg-surface">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="-mt-2 -mr-3 grid size-11 shrink-0 place-items-center rounded-full text-current hover:bg-ink/5">
          <X aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
          <span className="sr-only">Dismiss</span>
        </button>
      )}
    </div>
  );
}
