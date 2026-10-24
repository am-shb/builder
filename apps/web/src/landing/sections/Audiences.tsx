import { Briefcase, Rocket, Timer, Users, type LucideIcon } from "lucide-react";
import { AUDIENCES as C } from "../copy.ts";
import { Card, Section, SectionHeader } from "../layout.tsx";

const ICONS: LucideIcon[] = [Users, Briefcase, Rocket, Timer];

export function Audiences() {
  return (
    <Section id="who">
      <SectionHeader id="who" eyebrow={C.eyebrow} title={C.title} />
      <ul className="mt-14 mb-0 grid list-none gap-4 p-0 sm:grid-cols-2 md:mt-16 lg:grid-cols-4 lg:gap-5">
        {C.items.map((item, i) => {
          const Icon = ICONS[i]!;
          return (
            <Card as="li" key={item.title} delay={i * 80} className="p-6 sm:p-7">
              <span aria-hidden="true" className="grid size-11 place-items-center rounded-2xl bg-accent-tint text-accent-ink">
                <Icon className="size-5" />
              </span>
              <h3 className="display display-md mt-5 mb-0">{item.title}</h3>
              <p className="mt-3 mb-0 text-ink-2 text-pretty">{item.text}</p>
            </Card>
          );
        })}
      </ul>
    </Section>
  );
}
