import { ChevronRight, Monitor, Users, Video } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Skeleton } from "./Skeleton.tsx";
import { isInProgress, statusLabel } from "@builder/session-core";
import { StatusPill } from "./StatusPill.tsx";

const PLATFORM_ICON: Record<string, typeof Video> = { meet: Video, zoom: Monitor, teams: Users };

export type SessionRowProps = Omit<ComponentProps<"a">, "children"> & {
  // How the session is shown: the meeting code ("kfp-qzwd-nre") or a short name ("Teams meeting").
  code: string;
  status: string;
  platform: string;
  platformLabel: string;
  when: string;
  // Renders the row's link, for a router's own link component; a plain <a> otherwise.
  renderLink?: (props: { className: string; children: ReactNode }) => ReactNode;
};

const ROW = cn(
  "grid min-h-16 grid-cols-[minmax(0,1fr)_16px] items-center gap-x-2 gap-y-2 px-3 py-[15px]",
  "[grid-template-areas:'code_chev'_'line_chev']",
  "md:grid-cols-[minmax(0,1fr)_auto_24px] md:gap-x-5 md:gap-y-1.5 md:px-4 md:py-[18px] md:[grid-template-areas:'code_status_chev'_'meta_status_chev']",
);

const HAIRLINE = "relative before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-hair first:before:hidden md:before:inset-x-4";

// One tappable row: the whole row is the link. The code is first and largest, then the status, then platform and time.
// Ended and failed codes fade so active sessions stand out; sessions still on their way get a dashed underline.
export function SessionRow({ code, status, platform, platformLabel, when, className, renderLink, ...link }: SessionRowProps) {
  const PlatformIcon = PLATFORM_ICON[platform] ?? Video;
  const faded = status === "ended" || status === "failed" || status === "start_failed";
  const linkClass = cn(
    ROW,
    "group rounded-plate text-inherit no-underline transition-[background-color,transform] duration-150 ease-out hover:bg-plate active:bg-sunk motion-safe:active:scale-[0.99]",
    className,
  );
  // One label for assistive tech, read in order with pauses; the visual parts below are hidden from it.
  const content = (
    <>
      <span className="sr-only">{`${code}, ${statusLabel(status)}, ${platformLabel}, ${when}`}</span>
      <span
        aria-hidden="true"
        className={cn(
          "tabular min-w-0 truncate text-code font-medium tracking-[-0.03em] [grid-area:code] md:text-code-lg",
          faded && "text-ink-3",
          isInProgress(status) && "pb-[7px] underline decoration-primary/60 decoration-dashed decoration-2 underline-offset-[9px]",
        )}
      >
        {code}
      </span>
      <span aria-hidden="true" className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 [grid-area:line] md:contents">
        <StatusPill status={status} size="sm" className="md:h-[30px] md:gap-2 md:pr-3 md:pl-2.5 md:text-sm md:[grid-area:status] md:justify-self-end" />
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-ink-2 md:[grid-area:meta]">
          <PlatformIcon aria-hidden="true" className="hidden size-[15px] shrink-0 md:block" strokeWidth={1.75} />
          {platformLabel}, {when}
        </span>
      </span>
      <ChevronRight aria-hidden="true" strokeWidth={1.75}
        className="size-[18px] text-ink-3 transition-[transform,color] duration-150 [grid-area:chev] group-hover:translate-x-0.5 group-hover:text-ink" />
    </>
  );
  return (
    <li className={cn(HAIRLINE, "before:transition-opacity has-[a:hover]:before:opacity-0 [&:has(a:hover)+li]:before:opacity-0")}>
      {renderLink ? renderLink({ className: linkClass, children: content }) : <a className={linkClass} {...link}>{content}</a>}
    </li>
  );
}

export function SessionList({ children, className, ...props }: ComponentProps<"ul"> & { children: ReactNode }) {
  return <ul className={cn("m-0 -mx-3 list-none p-0 md:-mx-4", className)} {...props}>{children}</ul>;
}

// A row's shape while the list loads: the same grid, heights and chevron column as a real row, so nothing jumps
// when the data arrives.
export function SessionRowSkeleton() {
  return (
    <li aria-hidden="true" className={HAIRLINE}>
      <span className={cn(ROW, "min-h-16")}>
        <span className="flex h-[31px] items-center [grid-area:code] md:h-[43px]"><Skeleton className="h-7 w-[58%] md:h-8" /></span>
        <span className="flex items-center gap-2.5 [grid-area:line] md:contents">
          <Skeleton className="h-7 w-28 rounded-full md:h-[30px] md:[grid-area:status]" />
          <Skeleton className="h-4 w-36 md:[grid-area:meta]" />
        </span>
        <span className="[grid-area:chev]" />
      </span>
    </li>
  );
}
