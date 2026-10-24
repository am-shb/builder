import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { FINAL_CTA as C, SIGN_IN, SIGN_UP } from "../copy.ts";
import { Reveal, WRAP } from "../layout.tsx";

// The closing band: the primary color, the product's mark idea drawn large behind the words.
export function FinalCta() {
  return (
    <section aria-labelledby="final-cta-title" className="py-12 md:py-20">
      <div className={WRAP}>
        <Reveal className="relative isolate overflow-hidden rounded-sheet bg-primary px-6 py-16 text-center text-on-primary sm:px-12 md:py-24">
          <div aria-hidden="true" className="cta-art pointer-events-none absolute inset-0 -z-10">
            <span className="absolute -top-14 -left-14 h-44 w-56 rounded-[2.5rem] border-[3px] border-dashed border-on-primary/25 md:-top-10 md:-left-10 md:h-56 md:w-72" />
            <span className="absolute -right-16 -bottom-16 h-48 w-60 rounded-[2.5rem] bg-on-primary/10 md:-right-12 md:-bottom-14 md:h-60 md:w-80" />
          </div>
          <h2 id="final-cta-title" className="display display-lg mx-auto m-0 max-w-[18em]">{C.title}</h2>
          <p className="mx-auto mt-5 mb-0 max-w-[34em] text-lead text-pretty opacity-90">{C.text}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a href={SIGN_UP} className={cn("group inline-flex min-h-13 items-center gap-2 rounded-full bg-on-primary px-7 text-[16px] font-semibold text-primary no-underline shadow-[0_8px_24px_-10px_var(--scrim)] transition-transform motion-safe:active:scale-[0.98] max-sm:flex-1 max-sm:justify-center")}>
              Start free
              <ArrowRight aria-hidden="true" className="size-[18px] transition-transform motion-safe:group-hover:translate-x-0.5" />
            </a>
            <a href={SIGN_IN} className="inline-flex min-h-13 items-center rounded-full px-6 text-[16px] font-semibold text-on-primary no-underline ring-[1.5px] ring-on-primary/50 transition-colors hover:bg-on-primary/10 max-sm:flex-1 max-sm:justify-center">
              Sign in
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
