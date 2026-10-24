import { ArrowRight } from "lucide-react";
import { FINAL_CTA as C, SIGN_IN, SIGN_UP } from "../copy.ts";
import { Reveal, WRAP } from "../layout.tsx";

// The closing band, in its own deep green (--band) in both modes. The product's rule is drawn small in two corners,
// a dashed frame and a solid one, kept clear of the words; on narrow screens there is no room, so none. Its links
// carry their own focus ring, since the page's ring is the primary color.
export function FinalCta() {
  const link = "inline-flex min-h-13 items-center justify-center gap-2 rounded-full px-7 text-[16px] font-semibold whitespace-nowrap no-underline focus-visible:outline-band-ink max-sm:w-full";
  return (
    <section aria-labelledby="final-cta-title" className="py-12 md:py-20">
      <div className={WRAP}>
        <Reveal className="relative isolate overflow-hidden rounded-sheet bg-band px-6 py-16 text-center text-band-ink sm:px-12 md:py-24">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden lg:block">
            <span className="absolute top-8 left-8 size-24 rounded-[1.75rem] border-[2.5px] border-dashed border-band-ink/30" />
            <span className="absolute right-8 bottom-8 size-24 rounded-[1.75rem] bg-band-ink/12" />
          </div>
          <h2 id="final-cta-title" className="display display-lg mx-auto m-0 max-w-[14em] text-[clamp(1.875rem,3.6vw,3rem)]">{C.title}</h2>
          <p className="mx-auto mt-5 mb-0 max-w-[32em] text-lead text-pretty opacity-90">{C.text}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={SIGN_UP} className={`group ${link} bg-band-ink text-band shadow-[0_8px_24px_-10px_var(--scrim)] transition-transform motion-safe:active:scale-[0.98]`}>
              Start free
              <ArrowRight aria-hidden="true" className="size-[18px] transition-transform motion-safe:group-hover:translate-x-0.5" />
            </a>
            <a href={SIGN_IN} className={`${link} px-6 text-band-ink ring-[1.5px] ring-band-ink/50 transition-colors hover:bg-band-ink/10`}>
              Sign in
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
