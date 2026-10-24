import { Plus } from "lucide-react";
import { Accordion } from "radix-ui";
import { FAQ as C } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// Radix gives the accordion its keyboard use and states: each question is a button in a heading, with aria-expanded
// and aria-controls; Enter or Space opens it; several can be open at once.
export function Faq() {
  return (
    <Section id="faq" className="bg-plate/40">
      <SectionHeader id="faq" eyebrow={C.eyebrow} title={C.title} />
      <Reveal className="mx-auto mt-12 max-w-[820px] md:mt-14">
        <Accordion.Root type="multiple" className="grid gap-3">
          {C.items.map((item) => (
            <Accordion.Item key={item.q} value={item.q} className="rounded-plate bg-surface ring-1 ring-hair transition-shadow has-[[data-state=open]]:shadow-elevated">
              <Accordion.Header className="display display-md m-0">
                <Accordion.Trigger className="group flex min-h-16 w-full cursor-pointer items-center justify-between gap-4 rounded-plate px-5 py-4 text-left sm:px-6">
                  {item.q}
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-sunk text-ink-2 transition-[transform,background-color] duration-200 group-hover:bg-plate group-data-[state=open]:rotate-45">
                    <Plus className="size-[18px]" strokeWidth={2} />
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="overflow-hidden motion-safe:data-[state=closed]:animate-accordion-up motion-safe:data-[state=open]:animate-accordion-down">
                <p className="m-0 max-w-[60ch] px-5 pb-6 text-ink-2 text-pretty sm:px-6">{item.a}</p>
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </Reveal>
    </Section>
  );
}
