import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

// A whole-page state: not configured, no such session, sign-in coming. Centered, with a way forward.
export function PageState({ icon, title, children, action, className }: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto grid max-w-[28rem] justify-items-center px-5 py-16 text-center", className)}>
      {icon && <div className="mb-5">{icon}</div>}
      <h1 className="m-0 text-title font-semibold tracking-[-0.025em] text-balance">{title}</h1>
      {children && <div className="mt-2 text-ink-2 text-pretty">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
