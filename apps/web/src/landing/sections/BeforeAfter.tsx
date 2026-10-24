import { Check, Minus } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { BEFORE_AFTER as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// Today against with the product: the "before" card is dashed (still being decided), the "after" card solid.
export function BeforeAfter() {
  return (
    <Section id="before-after">
      <SectionHeader id="before-after" eyebrow={C.eyebrow} title={C.title} lead={C.lead} />
      <div className="mt-14 grid gap-5 md:mt-16 md:grid-cols-2 lg:gap-6">
        <Reveal className="flex min-w-0">
          <div className="flex w-full min-w-0 flex-col rounded-panel border-2 border-dashed border-[var(--outline)] bg-plate/50 p-6 sm:p-8">
            <NotesArt />
            <Label tone="muted">{C.before.label}</Label>
            <h3 className="display display-md mt-3 mb-0">{C.before.title}</h3>
            <Points points={C.before.points} icon="minus" />
          </div>
        </Reveal>
        <Reveal className="flex min-w-0" delay={120}>
          <div className="flex w-full min-w-0 flex-col rounded-panel bg-surface p-6 shadow-elevated ring-2 ring-primary/50 sm:p-8">
            <PrototypeArt />
            <Label tone="accent">{C.after.label}</Label>
            <h3 className="display display-md mt-3 mb-0">{C.after.title}</h3>
            <Points points={C.after.points} icon="check" />
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function Label({ tone, children }: { tone: "muted" | "accent"; children: string }) {
  return (
    <p className={cn("m-0 w-fit rounded-full px-3 py-1 text-sm font-semibold", tone === "muted" ? "bg-sunk text-ink-2" : "bg-accent-tint text-accent-ink")}>
      {children}
    </p>
  );
}

function Points({ points, icon }: { points: string[]; icon: "minus" | "check" }) {
  const Icon = icon === "check" ? Check : Minus;
  return (
    <ul className="mt-5 mb-0 grid list-none gap-3 p-0">
      {points.map((p) => (
        <li key={p} className="flex gap-3 text-ink-2">
          <span aria-hidden="true" className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", icon === "check" ? "bg-primary text-on-primary" : "bg-sunk text-ink-3")}>
            <Icon className="size-3.5" strokeWidth={3} />
          </span>
          <span className="text-pretty">{p}</span>
        </li>
      ))}
    </ul>
  );
}

// A page of notes: lines of text, a few crossed out, nothing to click.
function NotesArt() {
  const lines = ["w-[86%]", "w-[64%]", "w-[78%] line-through-art", "w-[52%]", "w-[70%]"];
  return (
    <div aria-hidden="true" className="mb-7 h-36 overflow-hidden rounded-plate bg-surface/70 p-5 ring-1 ring-hair sm:h-40">
      <div className="mb-3 h-2.5 w-24 rounded-full bg-ink-3/30" />
      <div className="grid gap-2.5">
        {lines.map((w, i) => (
          <div key={i} className={cn("relative h-2 rounded-full bg-ink-3/15", w.split(" ")[0])}>
            {w.includes("line-through-art") && <span className="absolute inset-x-0 top-1/2 h-px bg-ink-3/50" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// A small prototype with solid parts and a settled decision.
function PrototypeArt() {
  return (
    <div aria-hidden="true" className="dot-grid mb-7 grid h-36 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 overflow-hidden rounded-plate bg-plate/60 p-4 ring-1 ring-hair sm:h-40">
      <div className="grid content-start gap-2 rounded-xl bg-surface p-3 ring-1 ring-hair">
        <div className="h-2.5 w-14 rounded-full bg-primary/80" />
        <div className="h-2 w-full rounded-full bg-ink-3/15" />
        <div className="h-2 w-4/5 rounded-full bg-ink-3/15" />
        <div className="h-2 w-3/5 rounded-full bg-ink-3/15" />
      </div>
      <div className="grid content-between gap-2">
        <div className="grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-hair">
          <div className="flex items-center gap-2"><span className="size-3 rounded-full ring-[1.5px] ring-ink-3/40" /><span className="h-2 w-2/3 rounded-full bg-ink-3/20" /></div>
          <div className="flex items-center gap-2"><span className="size-3 rounded-full bg-primary" /><span className="h-2 w-1/2 rounded-full bg-ink-3/20" /></div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-accent-tint px-3 py-2 ring-[1.5px] ring-primary/70">
          <span className="grid size-4 place-items-center rounded-full bg-primary text-on-primary"><Check className="size-2.5" strokeWidth={4} /></span>
          <span className="h-2 w-16 min-w-0 shrink rounded-full bg-primary/40" />
          <span className="ml-auto text-[11px] font-bold text-accent-ink">Agreed</span>
        </div>
      </div>
    </div>
  );
}
