import { Check, Link as LinkIcon } from "lucide-react";
import { Mark } from "../../components/Mark.tsx";
import { BOT_NAME, STEPS as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// Three steps. Each number starts as a dashed ring and settles to solid as it comes into view (landing.css: .step-num).
export function HowItWorks() {
  const art = [<LinkArt key="link" />, <AdmitArt key="admit" />, <BuildArt key="build" />];
  return (
    <Section id="how-it-works" className="bg-plate/40">
      <SectionHeader id="how-it-works" eyebrow={C.eyebrow} title={C.title} lead={C.lead} />
      <ol className="mt-14 mb-0 grid list-none gap-5 p-0 md:mt-16 lg:grid-cols-3 lg:gap-6">
        {C.items.map((step, i) => (
          <Reveal as="li" key={step.title} delay={i * 120} className="step relative flex min-w-0 flex-col rounded-panel bg-surface p-6 shadow-elevated ring-1 ring-hair sm:p-7">
            <span aria-hidden="true" className="step-num relative grid size-12 place-items-center rounded-full bg-surface text-[17px] font-bold text-accent-ink">
              <span className="step-ring-dashed absolute inset-0 rounded-full border-2 border-dashed border-primary/60" />
              <span className="step-ring-solid absolute inset-0 rounded-full border-2 border-primary bg-accent-tint" />
              <span className="relative">{i + 1}</span>
            </span>
            <h3 className="display display-md mt-5 mb-0"><span className="sr-only">Step {i + 1}: </span>{step.title}</h3>
            <p className="mt-3 mb-6 text-ink-2 text-pretty">{step.text}</p>
            <div className="mt-auto min-w-0">{art[i]}</div>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

function LinkArt() {
  return (
    <div aria-hidden="true" className="grid gap-2.5 rounded-plate bg-plate/70 p-4 ring-1 ring-hair">
      <div className="flex min-w-0 items-center gap-2 rounded-field bg-surface px-3 py-2.5 ring-1 ring-[var(--outline)]">
        <LinkIcon className="size-4 shrink-0 text-ink-3" />
        <span className="truncate text-[13px] text-ink">meet.google.com/kfp-qzwd-nre</span>
      </div>
      <div className="rounded-full bg-primary py-2 text-center text-[13px] font-semibold text-on-primary">Start session</div>
    </div>
  );
}

function AdmitArt() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 rounded-plate bg-plate/70 p-4 ring-1 ring-hair">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-hair"><Mark className="size-7 rounded-lg" /></span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[13px] leading-snug font-semibold text-ink">{BOT_NAME} wants to join</p>
        <p className="m-0 text-[12px] text-ink-3">Waiting room</p>
      </div>
      <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-on-primary">Admit</span>
    </div>
  );
}

function BuildArt() {
  return (
    <div aria-hidden="true" className="dot-grid grid grid-cols-2 gap-2 rounded-plate bg-plate/70 p-4 ring-1 ring-hair">
      <div className="col-span-2 h-6 rounded-lg bg-surface ring-1 ring-hair" />
      <div className="h-14 rounded-lg bg-surface ring-1 ring-hair" />
      <div className="build-settle relative h-14 rounded-lg bg-surface">
        <span className="build-dashed absolute inset-0 rounded-lg border-[1.5px] border-dashed border-pending" />
        <span className="build-solid absolute inset-0 grid place-items-center rounded-lg border-[1.5px] border-primary/70">
          <Check className="size-4 text-primary" strokeWidth={3} />
        </span>
      </div>
    </div>
  );
}
