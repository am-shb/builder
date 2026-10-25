import { ArrowRight, Pause, Play, Smartphone, Video } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "../../components/Button.tsx";
import { androidAppUrl } from "../../lib/android-app-url.ts";
import { cn } from "../../lib/cn.ts";
import { ANDROID_APP, HERO, SIGN_UP } from "../copy.ts";
import { goToSection } from "../LandingNav.tsx";
import { useReducedMotion } from "../useReducedMotion.ts";
import { HeroScene } from "./HeroScene.tsx";

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

export function Hero() {
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const androidApp = androidAppUrl();
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div aria-hidden="true" className="dot-texture pointer-events-none absolute inset-x-0 -top-16 -z-10 h-[520px] md:h-[680px]" />
      {/* Two columns from 1280px, when both fit; stacked and centered below. Grid children may shrink (min-w-0), and
          the headline is sized from its own column (cqi), so the text never runs under the scene. */}
      <div className="mx-auto grid max-w-[1320px] items-center gap-y-14 px-4 pt-8 pb-16 sm:px-6 md:gap-y-16 md:pt-14 md:pb-20 lg:px-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-x-[clamp(3rem,5vw,6rem)] xl:pt-[clamp(3rem,8vh,6.5rem)] xl:pb-[clamp(4rem,10vh,8rem)] 2xl:max-w-[1440px]">
        {/* The words: headline, subheadline, actions, platforms, on one rhythm (24, 40, 28 px apart). Centered and
            stacked below 1280px; beside the scene from there, centered against it. */}
        <div className="@container w-full min-w-0 max-xl:mx-auto max-xl:max-w-[760px] max-xl:text-center">
          {/* Sized from its own column (cqi), with slightly tighter tracking: "Your meeting ends with" is about 10.5em
              wide at these sizes (optical sizing widens it as it gets smaller), so 9.25cqi keeps it on one line. From
              768px it breaks after it, two lines; on a phone it balances over three, keeping "a working" together. The tight
              line height lets the letters' box rise above the line, so a little top padding keeps them in the column. */}
          <h1
            id="hero-title"
            className="rise-in display display-xl m-0 pt-[0.12em] text-[clamp(1.875rem,10.6cqi,3rem)] leading-[1.02] tracking-[-0.02em] text-balance break-words md:text-[clamp(2.5rem,9.25cqi,4rem)] md:text-wrap xl:text-[clamp(2.75rem,9.25cqi,4.5rem)]"
            style={delay(0)}
          >
            {HERO.headline[0]}<br className="max-md:hidden" />{" "}
            <span className="whitespace-nowrap">{HERO.headline[1].split(" ").slice(0, 2).join(" ")}</span>{" "}
            {HERO.headline[1].split(" ").slice(2).join(" ")}
          </h1>
          <p className="rise-in mx-auto mt-6 mb-0 max-w-[33rem] text-lead text-pretty text-ink-2 xl:mx-0 xl:max-w-[31rem]" style={delay(80)}>
            <span className="font-semibold text-ink">{HERO.subLead}</span> {HERO.sub}
          </p>
          <div className="rise-in mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 max-xl:justify-center max-sm:flex-col max-sm:items-stretch" style={delay(160)}>
            <a href={SIGN_UP} className={cn(buttonVariants(), "group min-h-13 px-7 text-[16px] no-underline shadow-[0_8px_20px_-8px_var(--glow-a)]")}>
              Start free
              <ArrowRight aria-hidden="true" className="transition-transform motion-safe:group-hover:translate-x-0.5" />
            </a>
            {/* The second action is lighter: no outline, its play icon in a small disc. */}
            <a
              href="#demo"
              onClick={(e) => { e.preventDefault(); goToSection("#demo"); }}
              className={cn(buttonVariants({ variant: "secondary" }), "group min-h-13 gap-2.5 pr-5 pl-2 text-[16px] no-underline !shadow-none hover:bg-sunk max-sm:self-center")}
            >
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-surface text-accent-ink shadow-[0_1px_2px_var(--hair)] ring-1 ring-hair transition-transform motion-safe:group-hover:scale-105">
                <Play className="ml-0.5 !size-3.5 fill-current" />
              </span>
              Watch the demo
            </a>
          </div>
          <p className="rise-in mt-7 mb-0 text-[13.5px] leading-snug text-balance text-ink-3" style={delay(240)}>
            <Video aria-hidden="true" className="mr-2 inline size-4 -translate-y-px align-middle" />
            {HERO.platforms}
          </p>
          {androidApp && (
            <p className="rise-in mt-3 mb-0 text-[13.5px] leading-snug text-balance text-ink-3" style={delay(280)}>
              <Smartphone aria-hidden="true" className="mr-2 inline size-4 -translate-y-px align-middle" />
              {ANDROID_APP.lead}{" "}
              <a href={androidApp} className="font-semibold text-ink-2 underline underline-offset-2 transition-colors hover:text-ink">{ANDROID_APP.label}</a>
            </p>
          )}
        </div>
        <div className="rise-in-fade relative mx-auto w-full min-w-0 max-w-[720px] xl:max-w-none" style={delay(200)}>
          <p className="sr-only">{HERO.sceneSummary}</p>
          <HeroScene paused={paused} />
          {/* The scene loops, so it can be stopped (WCAG 2.2.2); this stops both meetings. In the hero's bottom padding, so
              the layout stays put. */}
          {!reduced && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="absolute right-1 -bottom-13 flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-2 transition-colors hover:bg-sunk hover:text-ink"
            >
              {paused ? <Play aria-hidden="true" className="size-4 fill-current" /> : <Pause aria-hidden="true" className="size-4 fill-current" />}
              {paused ? "Play animation" : "Pause animation"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
