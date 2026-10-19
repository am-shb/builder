import { cn } from "../lib/cn.ts";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block rounded-lg bg-ink/10 motion-safe:animate-pulse", className)} />;
}
