import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

const TONES = {
  warning: { box: "bg-warn-bg text-warn-ink", Icon: TriangleAlert },
  error: { box: "bg-danger-bg text-danger", Icon: CircleAlert },
  info: { box: "bg-info-bg text-info-ink", Icon: Info },
} as const;

// A persistent message with our own text. The unknown-outcome warning always uses one (role "alert"), never only a toast.
export function Callout({ tone = "warning", title, children, action, role, className }: {
  tone?: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div role={role} className={cn("flex gap-3.5 rounded-plate px-5 py-4", box, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="m-0 font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-ink">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
