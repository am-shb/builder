import { Check, Coffee, RotateCcw } from "lucide-react";
import { BOT_NAME } from "../brand.ts";
import { Phone, TopSlot } from "./PhoneSketch.tsx";

// The sign-up page's side panel, from 1024px: what the product is, one quiet picture from the landing hero's café
// meeting (the two options, A and B, with B picked by someone in the room), and one line of reassurance. Static and
// drawn with the page's own tokens, so it costs no images, no animation and nothing from the landing page's chunk. It
// is not a heading: the page's one heading is Clerk's card title. Every claim is true today (AGENTS.md).
export function SignUpIntro() {
  return (
    <div className="flex h-full flex-col justify-between gap-12 lg:py-6">
      <div>
        <p className="display m-0 text-[clamp(2.125rem,3.1vw,2.875rem)] leading-[1.03] tracking-[-0.02em]">
          Your next meeting ends with a <span className="text-accent-ink">working prototype.</span>
        </p>
        <p className="mt-3.5 mb-0 max-w-[30em] text-[16.5px] leading-[1.55] text-ink-2 text-pretty">
          <span className="font-semibold text-ink">An AI product manager for your calls.</span> It asks who the app is
          for, lays out the trade-offs, and builds what the room agrees on.
        </p>
      </div>
      <Preview />
      <p className="m-0 flex items-center gap-2 text-[14px] text-ink-3">
        <Check aria-hidden="true" className="size-4 shrink-0 text-accent-ink" strokeWidth={2.5} />
        Always visible in the meeting. Each organization's data is kept apart.
      </p>
    </div>
  );
}

// Two versions of a café app's home screen side by side, A and B, with B picked by Theo. The picture is hidden from
// screen readers; the caption says it.
function Preview() {
  return (
    <figure className="relative m-0">
      <div aria-hidden="true" className="hero-glow pointer-events-none absolute -inset-x-10 -inset-y-12 -z-10" />
      <div aria-hidden="true" className="grid grid-cols-2 gap-6 rounded-panel bg-surface bg-[radial-gradient(var(--dots)_1px,transparent_1.2px)] bg-[size:16px_16px] px-10 pt-12 pb-11 shadow-elevated ring-1 ring-hair">
        <Phone letter="A" top={<TopSlot icon={Coffee} tone="bg-warn-chip text-warn-ink" />} />
        <Phone letter="B" top={<TopSlot icon={RotateCcw} tone="bg-accent-tint text-accent-ink" />} picked tag={
          <span className="flex items-center gap-1 rounded-full bg-primary py-1 pr-2.5 pl-1.5 text-[12px] leading-none font-bold whitespace-nowrap text-on-primary">
            <Check className="size-3.5" strokeWidth={3} />Picked by Theo
          </span>
        } />
      </div>
      <figcaption className="sr-only">
        An example from a meeting about a café's ordering app: {BOT_NAME} shows two versions of the home screen side by
        side, A and B, and Theo, someone in the meeting, picks B.
      </figcaption>
    </figure>
  );
}
