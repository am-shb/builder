import { cn } from "../lib/cn.ts";

// The mark: a dashed frame behind a solid one, the product's own rule (still being decided, then agreed). It needs no
// letter, so it stays the same when the product's name changes. Decorative: the wordmark or a label names it.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <rect x="6.5" y="6.5" width="13" height="13" rx="3" fill="none" strokeWidth="2.2" strokeDasharray="3.4 2.6"
        strokeLinecap="round" className="stroke-on-primary opacity-90" />
      <rect x="12.5" y="12.5" width="13" height="13" rx="3" className="fill-on-primary" />
    </svg>
  );
}

// The same idea, larger and loose, for empty states.
export function DraftToAgreed({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative block h-16 w-21", className)}>
      <span className="absolute top-0 left-0 h-11 w-13 rounded-xl border-2 border-dashed border-primary/65" />
      <span className="absolute top-5 left-7 h-11 w-13 rounded-xl bg-primary shadow-glow" />
    </span>
  );
}
