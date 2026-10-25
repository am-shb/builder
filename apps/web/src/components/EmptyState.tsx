import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Mark } from "./Mark.tsx";

// An invitation, not a dead end: what this is, the real steps, and one way to start.
export function EmptyState({ title, description, steps, action, headingLevel = 2, className }: {
  title: string;
  description: string;
  steps?: string[];
  // Shown below 1024px only, where the page has no start panel beside it.
  action?: ReactNode;
  // 3 inside a section that already has a heading (the list's "Recent").
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div className={cn("grid justify-items-start rounded-panel bg-surface p-6 shadow-elevated md:max-w-[560px] md:p-9", className)}>
      <Mark className="size-16" />
      <Heading className="mt-5 mb-0 text-heading-lg font-semibold tracking-[-0.02em] text-balance">{title}</Heading>
      <p className="mt-1.5 mb-0 max-w-[30em] text-ink-2 text-pretty">{description}</p>
      {steps && (
        <ol className="mt-5 mb-0 grid list-none gap-3 p-0">
          {steps.map((step, i) => (
            <li key={step} className="flex items-center gap-3 font-medium">
              <span aria-hidden="true" className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-accent-tint text-[13px] font-bold text-accent-ink">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      )}
      {action && <div className="mt-6 w-full lg:hidden">{action}</div>}
    </div>
  );
}
