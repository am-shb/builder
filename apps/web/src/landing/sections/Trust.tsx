import { ArrowRight, Check } from "lucide-react";
import { TRUST as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// What the bot does in the room and with the data, each point true in the code today. Set as a decision log, the
// product's own way of writing things down: each promise a settled, solid entry.
export function Trust() {
  return (
    <Section id="trust">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeader id="trust" eyebrow={C.eyebrow} title={C.title} lead={C.lead} align="start-lg" />
          <Reveal className="max-lg:text-center">
            <a href="/privacy" className="group mt-7 inline-flex min-h-11 items-center gap-2 rounded-full font-semibold text-accent-ink no-underline hover:underline">
              {C.privacyLink}
              <ArrowRight aria-hidden="true" className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5" />
            </a>
          </Reveal>
        </div>
        <Reveal className="min-w-0 overflow-hidden rounded-panel bg-surface shadow-elevated ring-1 ring-hair">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair bg-plate/60 px-5 py-4 sm:px-7">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <span aria-hidden="true" className="size-2 rounded-full bg-live" />
              {C.logTitle}
            </p>
            <p className="m-0 text-sm text-ink-3">{C.logNote}</p>
          </div>
          <ul className="m-0 list-none p-0">
            {C.items.map((item) => (
              <li key={item.title} className="flex gap-4 border-hair px-5 py-6 sm:px-7 [&:not(:last-child)]:border-b">
                <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
                  <Check className="size-4" strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="display display-sm m-0">{item.title}</h3>
                    <span className="rounded-full bg-accent-tint px-2.5 py-0.5 text-[12.5px] font-semibold text-accent-ink">
                      {item.tag}
                    </span>
                  </div>
                  <p className="mt-2 mb-0 text-ink-2 text-pretty">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
