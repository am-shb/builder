import { Coffee, Croissant, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

// The sign-in and sign-up panels' picture: a café app's home screen on a phone, drawn as shapes rather than text so
// it reads at a glance (the app's title, what sits at the top, two menu cards). A `letter` names the option on the
// top-left corner; `picked` gives it a solid outline, and `tag` sits on the top-right corner.
export function Phone({ letter, top, picked, tag }: { letter?: string; top: ReactNode; picked?: boolean; tag?: ReactNode }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-[13rem] rounded-[22px] bg-surface p-3 pt-2.5", picked ? "ring-2 ring-primary" : "ring-1 ring-hair")}>
      {letter && (
        <span className={cn("absolute -top-3 left-3 grid size-6 place-items-center rounded-[7px] text-[13px] font-extrabold", picked ? "bg-primary text-on-primary" : "bg-ink text-surface")}>
          {letter}
        </span>
      )}
      {tag && <span className="absolute -top-3 right-3">{tag}</span>}
      <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-hair" />
      <span className="block h-2.5 w-20 rounded-full bg-ink/80" />
      {top}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MenuCard icon={Coffee} tone="bg-warn-chip text-warn-ink" />
        <MenuCard icon={Croissant} tone="bg-pending-soft text-pending-ink" />
      </div>
    </div>
  );
}

// What sits at the top of the home screen: the option itself, a tinted bar with its icon.
export function TopSlot({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <div className={cn("mt-3 flex items-center gap-2 rounded-xl p-2", tone)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface/70"><Icon className="size-4" /></span>
      <span className="grid flex-1 gap-1.5">
        <span className="block h-1.5 w-1/2 rounded-full bg-current opacity-50" />
        <span className="block h-2 w-4/5 rounded-full bg-ink/70" />
      </span>
    </div>
  );
}

function MenuCard({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <div className="rounded-xl bg-bg p-1.5 ring-1 ring-hair">
      <span className={cn("grid h-12 place-items-center rounded-lg", tone)}><Icon className="size-4 opacity-70" /></span>
      <span className="mt-2 mb-1 block h-1.5 w-3/4 rounded-full bg-ink/60" />
      <span className="block h-1.5 w-1/3 rounded-full bg-ink-3/60" />
    </div>
  );
}
