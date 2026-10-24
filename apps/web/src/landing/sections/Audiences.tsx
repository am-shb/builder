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
            <Card as="li" key={item.title} delay={i * 80} className="group p-6 sm:p-7">
              {/* The mark's idea: a dashed frame behind a solid one, holding the icon. */}
              <span aria-hidden="true" className="relative block h-13 w-14">
                <span className="absolute top-0 left-0 size-10 rounded-[14px] border-[1.5px] border-dashed border-primary/50 transition-transform duration-300 motion-safe:group-hover:-translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
                <span className="absolute right-0 bottom-0 grid size-10 place-items-center rounded-[14px] bg-primary text-on-primary shadow-glow">
                  <Icon className="size-5" />
                </span>
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
