import { Play } from "lucide-react";
import { DEMO as C, DEMO_VIDEO } from "../copy.ts";
import { Reveal, Section, SectionHeader } from "../layout.tsx";

// The demo video, self-hosted (DEMO_VIDEO in copy.ts). Until it exists, a frame says it's coming: nothing on the page
// looks playable that can't be played.
export function Demo() {
  return (
    <Section id="demo" className="bg-plate/40">
      <SectionHeader id="demo" eyebrow={C.eyebrow} title={C.title} lead={C.lead} />
      <Reveal className="mx-auto mt-12 max-w-[1040px] md:mt-14">
        <div className="relative overflow-hidden rounded-panel bg-surface p-2 shadow-elevated ring-1 ring-hair sm:p-3">
          {DEMO_VIDEO ? (
            // Add a captions <track> next to the video file when it arrives.
            <video className="block aspect-video w-full rounded-plate bg-ink" src={DEMO_VIDEO} controls preload="metadata" playsInline />
          ) : (
            <div className="hero-glow-soft dot-grid relative grid aspect-video w-full place-items-center rounded-plate bg-plate">
              <div className="grid justify-items-center gap-4 px-6 text-center">
                <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-primary text-on-primary shadow-glow sm:size-20">
                  <Play className="ml-1 size-7 fill-current sm:size-8" />
                </span>
                <p className="m-0 font-semibold text-ink-2">{C.placeholder}</p>
              </div>
            </div>
          )}
        </div>
      </Reveal>
    </Section>
  );
}
