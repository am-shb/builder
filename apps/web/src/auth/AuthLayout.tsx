import type { ReactNode } from "react";
import { Link } from "react-router";
import { BOT_NAME, PRODUCT_NAME } from "../brand.ts";
import { Mark } from "../components/Mark.tsx";

const STEPS = ["Paste the meeting link", `Admit ${BOT_NAME} when it asks to join`, "Watch the prototype take shape"];

// Sign-in, sign-up and choosing an organization: Clerk's card on our page. On desktop, a short message sits beside it;
// on phones the card is the page. The page's one heading is Clerk's card title, so the message is not a heading.
export function AuthLayout({ variant = "product", children }: { variant?: "product" | "organization"; children: ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh pb-12">
      <div aria-hidden="true" className="dot-texture pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px] md:h-[520px]" />
      <header className="mx-auto flex max-w-[1040px] items-center px-5 py-3 md:px-10 md:py-5">
        <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-xl text-ink no-underline">
          <Mark />
          <span className="text-[17px] font-[650] tracking-[-0.01em]">{PRODUCT_NAME}</span>
        </Link>
      </header>
      <main id="main" className="mx-auto max-w-[1040px] px-5 pt-2 md:grid md:grid-cols-2 md:items-center md:gap-x-16 md:px-10 md:pt-10">
        <div className="hidden md:block">
          {variant === "product" ? (
            <>
              <p className="m-0 text-title-lg font-semibold tracking-[-0.025em] text-balance">
                {BOT_NAME} joins your meeting and builds the prototype while you decide.
              </p>
              <ol className="mt-8 mb-0 grid list-none gap-3.5 p-0">
                {STEPS.map((step, i) => (
                  <li key={step} className="flex items-center gap-3 font-medium">
                    <span aria-hidden="true" className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-accent-tint text-[13px] font-bold text-accent-ink">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <p className="m-0 text-title font-semibold tracking-[-0.025em] text-balance">One more step: your organization.</p>
              <p className="mt-4 mb-0 max-w-[26em] text-ink-2">
                Every session belongs to an organization, so everyone on your team sees the same sessions. You can invite
                people and switch between organizations later.
              </p>
            </>
          )}
        </div>
        <div className="flex justify-center md:justify-end">{children}</div>
      </main>
    </div>
  );
}
