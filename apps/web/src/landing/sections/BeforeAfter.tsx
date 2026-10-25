import type { ReactNode } from "react";
import { ArrowRight, Check, CircleHelp, X } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { BEFORE_AFTER as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// Today against with the product. "Today" is a flat, dashed card (still being decided); the other is raised and solid.
// As the pair comes into view, a line in the notes is crossed out, then the "after" card and its prototype settle
// from dashed to solid and its decision is agreed (landing.css: .ba). With reduced motion, the settled state shows.
export function BeforeAfter() {
  return (
    <Section id="before-after">
      <SectionHeader id="before-after" eyebrow={C.eyebrow} title={C.title} lead={C.lead} />
      <Reveal className="ba relative isolate mt-14 grid gap-5 md:mt-16 md:grid-cols-2 lg:gap-8">
        <div className="relative flex w-full min-w-0 flex-col rounded-panel border-2 border-dashed border-[var(--outline)] bg-plate/50 p-6 sm:p-8">
          <NotesArt />
          <Label tone="before">{C.before.label}</Label>
          <h3 className="display display-md mt-4 mb-0 text-ink-2">{C.before.title}</h3>
          <Points points={C.before.points} tone="before" />
        </div>

        <Turn />

        <div className="relative flex min-w-0">
          {/* A soft light behind the card, so it reads as the one to have. */}
          <div aria-hidden="true" className="ba-glow pointer-events-none absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_45%,var(--glow-a),transparent_75%)] blur-2xl" />
          <div className="card-lift relative flex w-full min-w-0 flex-col rounded-panel bg-surface p-6 shadow-elevated sm:p-8">
            <span aria-hidden="true" className="ba-dashed pointer-events-none absolute inset-0 rounded-panel border-2 border-dashed border-pending/70" />
            <span aria-hidden="true" className="ba-solid pointer-events-none absolute inset-0 rounded-panel ring-2 ring-primary/55" />
            <PrototypeArt />
            <Label tone="after">{C.after.label}</Label>
            <h3 className="display display-md mt-4 mb-0">{C.after.title}</h3>
            <Points points={C.after.points} tone="after" />
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

// The turn from one to the other: a round arrow between the cards. Stacked, it sits in the gap and points down (its
// negative margins take no height); side by side, it sits over the middle and points right.
function Turn() {
  return (
    <span aria-hidden="true" className="ba-turn relative z-10 mx-auto -my-6 grid size-12 place-items-center rounded-full bg-primary text-on-primary shadow-glow ring-[6px] ring-[var(--bg)] md:absolute md:top-1/2 md:left-1/2 md:m-0 md:size-14 md:-translate-x-1/2 md:-translate-y-1/2">
      <ArrowRight className="size-5 max-md:rotate-90 md:size-6" strokeWidth={2.5} />
    </span>
  );
}

function Label({ tone, children }: { tone: "before" | "after"; children: string }) {
  return (
    <p className={cn(
      "m-0 inline-flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1 text-sm font-semibold sm:text-[15px]",
      tone === "before" ? "border-[1.5px] border-dashed border-[var(--outline)] text-ink-2" : "bg-primary text-on-primary",
    )}>
      {tone === "after" && <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />}
      {children}
    </p>
  );
}

function Points({ points, tone }: { points: string[]; tone: "before" | "after" }) {
  const Icon = tone === "after" ? Check : X;
  return (
    <ul className="mt-5 mb-0 grid list-none gap-3.5 p-0">
      {points.map((p) => (
        <li key={p} className={cn("flex gap-3", tone === "after" ? "text-ink" : "text-ink-2")}>
          <span aria-hidden="true" className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", tone === "after" ? "bg-primary text-on-primary" : "bg-sunk text-ink-3")}>
            <Icon className="size-3.5" strokeWidth={3} />
          </span>
          <span className="text-pretty">{p}</span>
        </li>
      ))}
    </ul>
  );
}

// A page of notes: lines of text, one crossed out, an open question, nothing to click.
function NotesArt() {
  const lines = ["w-[86%]", "w-[64%]", "w-[78%]", "w-[52%]", "w-[70%]"];
  return (
    <div aria-hidden="true" className="relative mb-7 h-36 overflow-hidden rounded-plate bg-surface/70 p-5 ring-1 ring-hair sm:h-40">
      <div className="mb-3 h-2.5 w-24 rounded-full bg-ink-3/30" />
      <div className="grid gap-2.5">
        {lines.map((w, i) => (
          <div key={i} className={cn("relative h-2 rounded-full bg-ink-3/15", w)}>
            {i === 2 && <span className="ba-strike absolute -inset-x-1 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-ink-3/60" />}
          </div>
        ))}
      </div>
      <span className="absolute top-4 right-4 grid size-8 place-items-center rounded-full border-[1.5px] border-dashed border-pending/70 text-pending">
        <CircleHelp className="size-4" strokeWidth={2.25} />
      </span>
    </div>
  );
}

// A small prototype whose parts settle from dashed to solid, and a decision that ends agreed.
function PrototypeArt() {
  return (
    <div aria-hidden="true" className="dot-grid mb-7 grid h-36 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 overflow-hidden rounded-plate bg-plate/60 p-4 ring-1 ring-hair sm:h-40">
      <Part className="ba-part content-start p-3">
        <div className="h-2.5 w-14 rounded-full bg-primary/80" />
        <div className="h-2 w-full rounded-full bg-ink-3/15" />
        <div className="h-2 w-4/5 rounded-full bg-ink-3/15" />
        <div className="h-2 w-3/5 rounded-full bg-ink-3/15" />
      </Part>
      <div className="grid min-w-0 grid-cols-1 content-between gap-2">
        <Part className="ba-part ba-part-2 p-3">
          <div className="flex items-center gap-2"><span className="size-3 rounded-full ring-[1.5px] ring-ink-3/40" /><span className="h-2 w-2/3 rounded-full bg-ink-3/20" /></div>
          <div className="flex items-center gap-2"><span className="size-3 rounded-full bg-primary" /><span className="h-2 w-1/2 rounded-full bg-ink-3/20" /></div>
        </Part>
        <div className="ba-decision relative flex items-center gap-2 rounded-xl px-3 py-2">
          <span className="ba-decision-bg absolute inset-0 rounded-xl bg-accent-tint ring-[1.5px] ring-primary/70" />
          <span className="ba-decision-draft absolute inset-0 rounded-xl border-[1.5px] border-dashed border-pending" />
          <span className="ba-check relative grid size-4 place-items-center rounded-full bg-primary text-on-primary"><Check className="size-2.5" strokeWidth={4} /></span>
          <span className="relative h-2 w-16 min-w-0 shrink rounded-full bg-primary/40" />
          <span className="ba-agreed relative ml-auto text-[11px] font-bold text-accent-ink">Agreed</span>
        </div>
      </div>
    </div>
  );
}

// One part of the prototype: a solid box, drawn dashed first while the card settles.
function Part({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("relative grid gap-2 rounded-xl bg-surface", className)}>
      <span className="ba-part-draft pointer-events-none absolute inset-0 rounded-xl border-[1.5px] border-dashed border-pending/80" />
      <span className="ba-part-done pointer-events-none absolute inset-0 rounded-xl ring-1 ring-hair" />
      {children}
    </div>
  );
}
