import { ArrowRight, FileLock2, Gauge, Megaphone, type LucideIcon } from "lucide-react";
import { TRUST as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// One icon per promise, in the order of C.items.
const ICONS: LucideIcon[] = [Megaphone, Gauge, FileLock2];

// What the bot does in the room and with the data, each point true in the code today. Set as a decision log, the
// product's own way of writing things down: each promise a settled, solid entry. On desktop the heading stays in view
// beside the list (sticky, below the bar).
export function Trust() {
  return (
    <Section id="trust">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16 xl:gap-20">
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
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hair bg-plate/60 px-5 py-4 sm:px-7">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <span aria-hidden="true" className="size-2 rounded-full bg-live" />
              {C.logTitle}
            </p>
            <p className="m-0 text-sm text-ink-3">{C.logNote}</p>
          </div>
          <ul className="m-0 list-none p-0">
            {C.items.map((item, i) => {
              const Icon = ICONS[i]!;
              return (
                <li key={item.title} className="group relative flex gap-4 border-hair px-5 py-6 transition-colors duration-300 hover:bg-plate/40 sm:gap-5 sm:px-7 sm:py-7 [&:not(:last-child)]:border-b">
                  {/* The product's rule, still being decided then agreed: a dashed frame behind a solid one, holding the icon. */}
                  <span aria-hidden="true" className="relative block size-12 shrink-0">
                    <span className="absolute top-0 left-0 size-[38px] rounded-[12px] border-[1.5px] border-dashed border-primary/50 transition-transform duration-300 motion-safe:group-hover:-translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
                    <span className="absolute right-0 bottom-0 grid size-[38px] place-items-center rounded-[12px] bg-primary text-on-primary">
                      <Icon className="size-[18px]" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[12.5px] font-semibold tracking-[0.06em] text-accent-ink uppercase">{item.tag}</p>
                    <h3 className="display display-sm mt-1 mb-0 text-[1.125rem] text-balance sm:text-[1.25rem]">{item.title}</h3>
                    <p className="mt-1.5 mb-0 text-ink-2 text-pretty">{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
