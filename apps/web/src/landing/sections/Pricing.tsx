import { Check } from "lucide-react";
import { buttonVariants } from "../../components/Button.tsx";
import { cn } from "../../lib/cn.ts";
import { PRICING as C } from "../copy.ts";
import { Card, Reveal, Section, SectionHeader } from "../layout.tsx";

// The Free plan, and one line on the paid ones (ADR 0009). Their prices aren't set and billing isn't built, so they
// get no cards of their own until they are.
export function Pricing() {
  const plan = C.free;
  return (
    <Section id="pricing">
      <SectionHeader id="pricing" eyebrow={C.eyebrow} title={C.title} />
      <Card as="div" outer="mx-auto mt-14 max-w-[30rem] md:mt-16" className="flex flex-col p-6 sm:p-8">
        <h3 className="display display-md m-0">{plan.name}</h3>
        <p className="mt-1.5 mb-0 text-ink-2">{plan.blurb}</p>
        <p className="mt-6 mb-0 text-heading-lg font-semibold tracking-[-0.02em]">{plan.price}</p>
        <ul className="mt-6 mb-8 grid list-none gap-3 p-0">
          {plan.points.map((p) => (
            <li key={p} className="flex gap-3 text-ink-2">
              <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" strokeWidth={3} />
              {p}
            </li>
          ))}
        </ul>
        <a href={plan.cta.href} className={cn(buttonVariants({ block: true }), "no-underline")}>{plan.cta.label}</a>
      </Card>
      <Reveal>
        <p className="mx-auto mt-6 mb-0 max-w-[30rem] text-center text-sm text-ink-2 text-pretty">{C.paid}</p>
      </Reveal>
    </Section>
  );
}
