import { cn } from "../lib/cn.ts";

export function Spinner({ className }: { className?: string }) {
  return (
    <span aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 rounded-full border-2 border-current/30 border-t-current animate-spin-soft", className)} />
  );
}
