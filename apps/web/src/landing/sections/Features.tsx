import { Braces, Check, Download, MousePointer2 } from "lucide-react";
import { Mark } from "../../components/Mark.tsx";
import { cn } from "../../lib/cn.ts";
import { BOT_NAME, FEATURES as C } from "../copy.ts";
import type { ReactNode } from "react";
import { Card, Section, SectionHeader } from "../layout.tsx";
import { useInView } from "../useInView.ts";

// The features as a bento grid. Each card has a small visual whose motion runs only while the grid is on screen
// (data-live) and motion is allowed (landing.css: .bento).
export function Features() {
  const [ref, live] = useInView<HTMLDivElement>({ rootMargin: "0px" });
  const f = C.items;
  return (
    <Section id="features">
      <SectionHeader id="features" eyebrow={C.eyebrow} title={C.title} lead={C.lead} align="start-lg" />
      <div ref={ref} data-live={live || undefined} className="bento mt-14 grid gap-4 md:mt-16 md:grid-cols-2 lg:grid-cols-6 lg:gap-5">
        <Feature outer="lg:col-span-4" title={f.prototype.title} text={f.prototype.text} art={<PrototypeArt />} wide />
        <Feature outer="lg:col-span-2" title={f.grounded.title} text={f.grounded.text} art={<GroundedArt />} delay={80} />
        <Feature outer="lg:col-span-2" title={f.options.title} text={f.options.text} art={<OptionsArt />} />
        <Feature outer="lg:col-span-2" title={f.voice.title} text={f.voice.text} art={<VoiceArt />} delay={80} />
        <Feature outer="md:col-span-2 lg:col-span-2" title={f.handoff.title} text={f.handoff.text} art={<HandoffArt />} delay={160} />
        <Feature outer="md:col-span-2 lg:col-span-6" title={f.teams.title} text={f.teams.text} art={<TeamsArt />} banner />
      </div>
    </Section>
  );
}

function Feature({ title, text, art, outer, wide, banner, delay }: {
  title: string; text: string; art: ReactNode; outer?: string; wide?: boolean; banner?: boolean; delay?: number;
}) {
  return (
    <Card outer={outer} delay={delay} className={cn("group flex flex-col overflow-hidden p-6 sm:p-7", banner && "lg:flex-row lg:items-center lg:gap-10")}>
      <div aria-hidden="true" className={cn("art relative mb-6 overflow-hidden rounded-plate bg-plate/70 ring-1 ring-hair", wide ? "h-48 sm:h-52" : "h-40", banner && "lg:order-2 lg:mb-0 lg:h-36 lg:w-[46%] lg:shrink-0")}>
        {art}
      </div>
      <div className={cn("min-w-0", banner && "lg:flex-1")}>
        <h3 className="display display-md m-0">{title}</h3>
        <p className="mt-3 mb-0 max-w-[40em] text-ink-2 text-pretty">{text}</p>
      </div>
    </Card>
  );
}

// Screens assembling on the stage, one part after another.
function PrototypeArt() {
  return (
    <div className="dot-grid absolute inset-0 grid grid-cols-[0.8fr_2fr] gap-3 p-4 sm:p-5">
      <div className="grid content-start gap-2 rounded-xl bg-surface p-3 ring-1 ring-hair">
        <div className="mb-1 flex items-center gap-1.5"><Mark className="size-4 rounded" /><span className="h-2 w-10 rounded-full bg-ink-3/30" /></div>
        {[0, 1, 2, 3].map((i) => <div key={i} className={cn("h-2 rounded-full", i === 1 ? "w-4/5 bg-primary/60" : "w-3/5 bg-ink-3/15")} />)}
      </div>
      <div className="grid grid-rows-[auto_1fr] gap-3">
        <div className="build-part flex h-9 items-center justify-between rounded-xl bg-surface px-3 ring-1 ring-hair" style={{ animationDelay: "0s" }}>
          <span className="h-2.5 w-24 min-w-0 shrink rounded-full bg-ink/70" />
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10.5px] font-semibold text-on-primary">New</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["0.5s", "1s", "1.5s"].map((d, i) => (
            <div key={d} className="build-part relative grid content-start gap-1.5 rounded-xl bg-surface p-2.5 ring-1 ring-hair" style={{ animationDelay: d }}>
              <div className="h-10 rounded-lg bg-accent-tint" />
              <div className="h-2 w-4/5 rounded-full bg-ink-3/25" />
              <div className="h-2 w-1/2 rounded-full bg-ink-3/15" />
              {i === 2 && <span className="draft-tag absolute -top-2 right-2 rounded-[5px] bg-pending px-1 text-[9.5px] leading-[1.4] font-extrabold text-surface">Draft</span>}
            </div>
          ))}
        </div>
      </div>
      <MousePointer2 className="pointer-glide absolute top-[58%] left-[46%] size-5 fill-ink text-surface drop-shadow" strokeWidth={1.5} />
    </div>
  );
}

// A quote, and the decision it settles.
function GroundedArt() {
  return (
    <div className="absolute inset-0 grid content-center gap-3 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-warn-chip text-[10.5px] font-bold text-warn-ink">J</span>
        <span className="rounded-2xl rounded-tl-md bg-surface px-3 py-2 text-[12.5px] leading-snug font-medium text-ink ring-1 ring-hair">“Yes, under the title.”</span>
      </div>
      <div className="relative flex items-center gap-2 rounded-xl px-3 py-2">
        <span className="swap-a absolute inset-0 rounded-xl border-[1.5px] border-dashed border-pending bg-pending-soft" />
        <span className="swap-b absolute inset-0 rounded-xl border-[1.5px] border-primary bg-accent-tint" />
        <span className="relative grid size-4 place-items-center">
          <span className="swap-a absolute inset-0 rounded-full border-2 border-pending/60" />
          <span className="swap-b absolute inset-0 grid place-items-center rounded-full bg-primary text-on-primary"><Check className="size-2.5" strokeWidth={4} /></span>
        </span>
        <span className="relative min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">Due date on tasks</span>
        <span className="relative inline-grid text-[11px] font-bold">
          <span className="swap-a col-start-1 row-start-1 text-pending-ink">Pending</span>
          <span className="swap-b col-start-1 row-start-1 text-accent-ink">Agreed</span>
        </span>
      </div>
    </div>
  );
}

// Two options side by side; the room's choice moves between them.
function OptionsArt() {
  return (
    <div className="absolute inset-0 grid grid-cols-2 gap-3 p-4 sm:p-5">
      {["A", "B"].map((l, i) => (
        <div key={l} className="relative grid content-start gap-2 rounded-xl bg-surface p-3 ring-1 ring-hair">
          <span className={cn("pick absolute -inset-[3px] rounded-[14px] ring-2 ring-primary", i === 0 ? "pick-a" : "pick-b")} />
          <span className="grid size-7 place-items-center rounded-lg bg-accent-tint text-[14px] font-extrabold text-accent-ink">{l}</span>
          <div className={cn("rounded-md bg-ink-3/15", i === 0 ? "h-8" : "h-4")} />
          <div className="h-2 w-4/5 rounded-full bg-ink-3/20" />
          <div className="h-2 w-3/5 rounded-full bg-ink-3/15" />
        </div>
      ))}
    </div>
  );
}

// A voice line, as a waveform and the words it said.
function VoiceArt() {
  const bars = [0.35, 0.7, 0.5, 0.95, 0.6, 0.8, 0.4, 0.75, 0.55, 0.9, 0.45, 0.65, 0.3];
  return (
    <div className="absolute inset-0 grid content-center justify-items-center gap-4 p-4 sm:p-5">
      <div className="flex h-12 items-center gap-1.5">
        {bars.map((h, i) => <span key={i} className="wave w-1.5 rounded-full bg-primary" style={{ height: `${h * 100}%`, animationDelay: `${(i % 5) * 0.12}s` }} />)}
      </div>
      <span className="max-w-full truncate rounded-full bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-ink ring-1 ring-hair">“{BOT_NAME}, show option B.”</span>
    </div>
  );
}

// The handoff page: its sections, and the spec as JSON.
function HandoffArt() {
  return (
    <div className="absolute inset-0 grid grid-cols-[1.3fr_1fr] gap-3 p-4 sm:p-5">
      <div className="grid content-start gap-2 rounded-xl bg-surface p-3 ring-1 ring-hair">
        <div className="h-2.5 w-20 rounded-full bg-ink/60" />
        {["Agreed", "Agreed", "Open"].map((s, i) => (
          <div key={i} className="log-row flex items-center gap-1.5" style={{ animationDelay: `${i * 0.5}s` }}>
            <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-full", s === "Open" ? "border-[1.5px] border-dashed border-pending" : "bg-primary text-on-primary")}>
              {s !== "Open" && <Check className="size-2" strokeWidth={4} />}
            </span>
            <span className="h-2 flex-1 rounded-full bg-ink-3/20" />
          </div>
        ))}
      </div>
      <div className="grid content-between gap-2 rounded-xl bg-ink p-3 text-bg">
        <Braces className="size-5 opacity-80" />
        <div className="grid gap-1.5">
          <span className="h-1.5 w-4/5 rounded-full bg-bg/40" />
          <span className="h-1.5 w-3/5 rounded-full bg-bg/30" />
          <span className="h-1.5 w-2/3 rounded-full bg-bg/20" />
        </div>
        <span className="flex items-center gap-1 text-[10.5px] font-semibold opacity-90"><Download className="size-3" /> JSON</span>
      </div>
    </div>
  );
}

// An organization's people, sharing one list of sessions.
function TeamsArt() {
  const people = [
    { i: "M", c: "bg-s-live-bg text-s-live-ink" }, { i: "J", c: "bg-warn-chip text-warn-ink" },
    { i: "S", c: "bg-p-c-bg text-p-c-ink" }, { i: "A", c: "bg-info-bg text-info-ink" },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-5 p-4 sm:p-5">
      <div className="flex -space-x-2.5 transition-[gap] motion-safe:group-hover:-space-x-1">
        {people.map((p) => <span key={p.i} className={cn("grid size-10 place-items-center rounded-full text-[14px] font-bold ring-[3px] ring-plate transition-transform", p.c)}>{p.i}</span>)}
      </div>
      <div className="grid min-w-0 gap-1.5 rounded-xl bg-surface p-3 ring-1 ring-hair">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-ink"><span className="size-2 rounded-full bg-live" />Your team · 4 members</span>
        <span className="h-2 w-32 max-w-full rounded-full bg-ink-3/20" />
        <span className="h-2 w-24 max-w-full rounded-full bg-ink-3/15" />
      </div>
    </div>
  );
}
