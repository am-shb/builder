import type { ReactNode } from "react";
import { PRODUCT_NAME } from "../brand.ts";
import { ColorModeMenu } from "../components/ColorModeMenu.tsx";
import { Mark } from "../components/Mark.tsx";
import { cn } from "../lib/cn.ts";
import { SignInIntro } from "./SignInIntro.tsx";
import { SignUpIntro } from "./SignUpIntro.tsx";

// Sign-in, sign-up and choosing an organization: Clerk's card on our page, over the landing page's dot texture and
// soft light. From 1024px, a short message sits beside it, the two centered in the space under the header; on
// narrower screens the card is the page. Sign-in and sign-up have their own panels (SignInIntro, SignUpIntro), as tall
// as Clerk's form. The page's one heading is Clerk's card title, so the message is not a heading. The message is in
// the display face; Clerk's card keeps the text face (ADR 0015). The logo is a plain link, so `/` loads as the landing
// page.
export function AuthLayout({ variant = "sign-in", children }: { variant?: "sign-in" | "sign-up" | "organization"; children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip pb-12">
      <div aria-hidden="true" className="dot-texture pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px] md:h-[620px]" />
      <header className="mx-auto flex w-full max-w-[1120px] items-center px-5 py-3 md:px-10 md:py-5">
        <a href="/" className="mr-auto flex min-h-11 items-center gap-2.5 rounded-xl text-ink no-underline">
          <Mark />
          <span className="text-[17px] font-[650] tracking-[-0.01em]">{PRODUCT_NAME}</span>
        </a>
        <ColorModeMenu />
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-[1120px] px-5 pt-2 md:px-10 md:pt-10 lg:grid lg:flex-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:content-center lg:items-center lg:gap-x-[clamp(3rem,7vw,7rem)] lg:pt-0 lg:pb-[6vh]"
      >
        <div className={cn("hidden max-w-[36rem] lg:block", variant !== "organization" && "lg:self-stretch")}>
          {variant === "sign-up" ? (
            <SignUpIntro />
          ) : variant === "sign-in" ? (
            <SignInIntro />
          ) : (
            <>
              <p className="display m-0 text-[clamp(2rem,3vw,2.5rem)] leading-[1.04] tracking-[-0.02em]">One more step: your organization.</p>
              <p className="mt-5 mb-0 max-w-[26em] text-ink-2">
                Every session belongs to an organization, so everyone on your team sees the same sessions. You can invite
                people and switch between organizations later.
              </p>
            </>
          )}
        </div>
        <div className="relative flex justify-center">
          <div aria-hidden="true" className="hero-glow pointer-events-none absolute -inset-x-16 -inset-y-20 -z-10 max-lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
