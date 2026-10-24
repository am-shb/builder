import { ArrowRight, Play, Video } from "lucide-react";
import { buttonVariants } from "../../components/Button.tsx";
import { cn } from "../../lib/cn.ts";
import { HERO, SIGN_UP } from "../copy.ts";
import { goToSection } from "../LandingNav.tsx";
import { HeroScene } from "./HeroScene.tsx";

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div aria-hidden="true" className="dot-texture pointer-events-none absolute inset-x-0 -top-16 -z-10 h-[520px] md:h-[680px]" />
      {/* Two columns from 1280px, when both fit; stacked and centered below. Grid children may shrink (min-w-0), and
          the headline is sized from its own column (cqi), so the text never runs under the scene. */}
      <div className="mx-auto grid max-w-[1320px] items-center gap-y-14 px-4 pt-8 pb-16 sm:px-6 md:gap-y-16 md:pt-14 md:pb-20 lg:px-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-x-[clamp(3rem,5vw,6rem)] xl:pt-[clamp(3rem,8vh,6.5rem)] xl:pb-[clamp(4rem,10vh,8rem)] 2xl:max-w-[1440px]">
        <div className="@container w-full min-w-0 max-xl:mx-auto max-xl:max-w-[780px] max-xl:text-center">
          <p className="rise-in m-0 inline-flex items-center gap-2 rounded-full border border-dashed border-primary/45 bg-surface/60 py-1.5 pr-3.5 pl-2.5 text-[13.5px] font-semibold text-accent-ink" style={delay(0)}>
            <span className="size-2 rounded-full bg-live animate-breathe" aria-hidden="true" />
            {HERO.eyebrow}
          </p>
          {/* display-xl's line height and tracking, at a size taken from the column (cqi): "Your meeting ends with" is
              about 10.4em wide at these sizes (optical sizing widens it as it gets smaller), so 9.2cqi keeps it on
              one line. From 768px the headline breaks after it, two lines, and wraps
              normally (balancing would even it out into three). */}
          <h1
            id="hero-title"
            className="rise-in display display-xl mt-5 mb-0 text-[clamp(2rem,10cqi,2.75rem)] break-words md:text-[clamp(2.25rem,9.2cqi,3.75rem)] md:text-wrap xl:text-[clamp(2.5rem,9.2cqi,4rem)]"
            style={delay(80)}
          >
            {HERO.headline[0]}<br className="max-md:hidden" /> {HERO.headline[1]}
          </h1>
          <p className="rise-in mx-auto mt-6 mb-0 max-w-[34em] text-lead text-pretty text-ink-2 xl:mx-0" style={delay(160)}>{HERO.sub}</p>
          <div className="rise-in mt-8 flex flex-wrap items-center gap-3 max-xl:justify-center" style={delay(240)}>
            <a href={SIGN_UP} className={cn(buttonVariants(), "group min-h-13 px-7 text-[16px] no-underline max-sm:flex-1")}>
              Start free
              <ArrowRight aria-hidden="true" className="transition-transform motion-safe:group-hover:translate-x-0.5" />
            </a>
            <a
              href="#demo"
              onClick={(e) => { e.preventDefault(); goToSection("#demo"); }}
              className={cn(buttonVariants({ variant: "secondary" }), "min-h-13 px-6 text-[16px] no-underline max-sm:flex-1")}
            >
              <Play aria-hidden="true" className="fill-current" />
              Watch the demo
            </a>
          </div>
          <p className="rise-in mt-6 mb-0 text-sm text-balance text-ink-3" style={delay(320)}>
            <Video aria-hidden="true" className="mr-2 inline size-4 -translate-y-px align-middle" />
            {HERO.platforms}
          </p>
        </div>
        <div className="rise-in relative mx-auto w-full min-w-0 max-w-[720px] xl:max-w-none" style={delay(200)}>
          <p className="sr-only">{HERO.sceneSummary}</p>
          <HeroScene />
        </div>
      </div>
    </section>
  );
}
