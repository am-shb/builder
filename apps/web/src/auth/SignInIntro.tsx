import { Check, RotateCcw } from "lucide-react";
import { Phone, TopSlot } from "./PhoneSketch.tsx";

// The sign-in page's side panel, from 1024px: a welcome back for returning members, a line on what is waiting for
// them, and the sign-up panel's picture cut down to one finished screen. Calmer than sign-up's: no options, no
// reassurances. It is not a heading: the page's one heading is Clerk's card title.
export function SignInIntro() {
  return (
    <div className="flex h-full flex-col justify-between gap-12 lg:py-6">
      <div>
        <p className="display m-0 text-[clamp(2.125rem,3.1vw,2.875rem)] leading-[1.03] tracking-[-0.02em]">
          Welcome <span className="text-accent-ink">back.</span>
        </p>
        <p className="mt-3.5 mb-0 max-w-[26em] text-[16.5px] leading-[1.55] text-ink-2 text-pretty">
          Your sessions, prototypes and decisions are right where you left them.
        </p>
      </div>
      {/* Decoration only: the text above says it all. */}
      <div aria-hidden="true" className="relative max-w-[22rem]">
        <div className="hero-glow pointer-events-none absolute -inset-x-10 -inset-y-12 -z-10" />
        <div className="grid place-items-center rounded-panel bg-surface bg-[radial-gradient(var(--dots)_1px,transparent_1.2px)] bg-[size:16px_16px] px-10 pt-12 pb-10 shadow-elevated ring-1 ring-hair">
          <Phone
            top={<TopSlot icon={RotateCcw} tone="bg-accent-tint text-accent-ink" />}
            picked
            tag={<span className="grid size-6 place-items-center rounded-full bg-primary text-on-primary"><Check className="size-3.5" strokeWidth={3} /></span>}
          />
        </div>
      </div>
    </div>
  );
}
