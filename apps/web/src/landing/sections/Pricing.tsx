import { Check, Mail } from "lucide-react";
import { buttonVariants } from "../../components/Button.tsx";
import { cn } from "../../lib/cn.ts";
import { mailto, PRICING as C, PRODUCT_NAME } from "../copy.ts";
import { Card, Reveal, Section, SectionHeader } from "../layout.tsx";

// Three plans (ADR 0009). Billing isn't built, so only Free has a working sign-up; Pro and Team are an email to us,
// marked with a mail icon.
// No prices until they are set, and no monthly or yearly switch: ADR 0009 has no yearly plan.
export function Pricing() {
  return (
    <Section id="pricing">
      <SectionHeader id="pricing" eyebrow={C.eyebrow} title={C.title} />
      <ul className="mt-14 mb-0 grid list-none gap-4 p-0 md:mt-16 md:grid-cols-3 lg:gap-5">
        {C.plans.map((plan, i) => {
          const href = plan.cta.href === "pro" ? mailto(`${PRODUCT_NAME} Pro waitlist`) : plan.cta.href === "team" ? mailto(`${PRODUCT_NAME} Team`) : plan.cta.href;
          return (
            <Card as="li" key={plan.name} delay={i * 90} className="flex flex-col p-6 sm:p-8">
              <h3 className="display display-md m-0">{plan.name}</h3>
              <p className="mt-1.5 mb-0 text-ink-2">{plan.blurb}</p>
              <p className={cn("mt-6 mb-0 flex min-h-8 items-end", plan.cta.href.startsWith("/") ? "text-heading-lg font-semibold tracking-[-0.02em]" : "text-label font-semibold text-ink-2")}>{plan.price}</p>
              <ul className="mt-6 mb-8 grid list-none gap-3 p-0">
                {plan.points.map((p) => (
                  <li key={p} className="flex gap-3 text-ink-2">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" strokeWidth={3} />
                    {p}
                  </li>
                ))}
              </ul>
              <a
                href={href}
                className={cn(buttonVariants({ variant: plan.cta.href.startsWith("/") ? "primary" : "secondary", block: true }), "mt-auto no-underline")}
              >
                {!plan.cta.href.startsWith("/") && <Mail aria-hidden="true" />}
                {plan.cta.label}
              </a>
            </Card>
          );
        })}
      </ul>
      <Reveal>
        <p className="mx-auto mt-8 mb-0 max-w-[44em] text-center text-sm text-ink-2 text-pretty">{C.note}</p>
      </Reveal>
    </Section>
  );
}
