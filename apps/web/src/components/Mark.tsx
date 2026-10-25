import { cn } from "../lib/cn.ts";

// The mark: Builder's robot, the one on the shared screen (apps/engine/public/stage.html) in its listening pose, drawn
// in the primary's green for each color mode. It needs no letter, so it stays the same when the product's name
// changes. public/favicon.svg is the same drawing. Decorative: a wordmark or label names it.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="-8 -18 166 166" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect x="73" width="4" height="26" rx="2" className="fill-bot-stem" />
      <circle cx="75" r="12" className="fill-bot-bulb" />
      <rect y="24" width="150" height="118" rx="38" className="fill-bot-chin" />
      <rect y="24" width="150" height="110" rx="38" className="fill-bot-head" />
      <rect x="20" y="42" width="110" height="70" rx="26" className="fill-bot-face" />
      <rect x="42" y="54" width="22" height="30" rx="11" className="fill-bot-eye" />
      <rect x="86" y="54" width="22" height="30" rx="11" className="fill-bot-eye" />
      <path d="M63 88a12 11 0 0 0 24 0" fill="none" className="stroke-bot-eye" strokeWidth="4" />
    </svg>
  );
}
