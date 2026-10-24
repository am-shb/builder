import { ArrowRight, Building2, Eye, Gauge, MessageSquareQuote, ShieldCheck, type LucideIcon } from "lucide-react";
import { TRUST as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

const ICONS: LucideIcon[] = [Eye, MessageSquareQuote, Building2, Gauge, ShieldCheck];

// What the bot does in the room and with the data, each point true in the code today.
export function Trust() {
  return (
    <Section id="trust">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeader id="trust" eyebrow={C.eyebrow} title={C.title} lead={C.lead} align="start" className="max-lg:mx-auto max-lg:text-center" />
          <Reveal className="max-lg:text-center">
            <a href="/privacy" className="group mt-7 inline-flex min-h-11 items-center gap-2 rounded-full font-semibold text-accent-ink no-underline hover:underline">
              {C.privacyLink}
              <ArrowRight aria-hidden="true" className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5" />
            </a>
          </Reveal>
        </div>
        <ul className="m-0 grid list-none gap-3 p-0">
          {C.items.map((item, i) => {
            const Icon = ICONS[i]!;
            return (
              <Reveal as="li" key={item.title} delay={i * 70} className="flex gap-4 rounded-plate bg-surface p-5 ring-1 ring-hair sm:p-6">
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-tint text-accent-ink">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="display display-sm m-0">{item.title}</h3>
                  <p className="mt-1.5 mb-0 text-ink-2 text-pretty">{item.text}</p>
                </div>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
