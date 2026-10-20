import { cn } from "../lib/cn.ts";

// The api's session statuses and their labels (the plan's status table). Anything else shows as "Unknown", so a new
// status from the api never breaks the page.
export const STATUS_LABELS: Record<string, string> = {
  starting: "Starting",
  joining: "Joining",
  in_meeting: "In the meeting",
  ended: "Ended",
  failed: "Failed",
  start_failed: "Didn't start",
  start_unknown: "Check the meeting",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Unknown";
}

// Statuses still on their way: drawn dashed, the product's own rule.
export function isInProgress(status: string): boolean {
  return status === "starting" || status === "joining";
}

const TONE: Record<string, string> = {
  in_meeting: "bg-s-live-bg text-s-live-ink",
  starting: "bg-s-join-bg text-s-join-ink",
  joining: "bg-s-join-bg text-s-join-ink",
  start_unknown: "bg-s-warn-bg text-s-warn-ink",
  start_failed: "bg-s-fail-bg text-s-fail-ink",
  // Tinted like "Didn't start", told apart by its diamond: a past failure shouldn't outshine a live meeting.
  failed: "bg-s-fail-bg text-s-fail-ink",
};

function Dot({ status }: { status: string }) {
  if (status === "in_meeting") {
    return <span className="size-2 shrink-0 rounded-full bg-live shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_25%,transparent)] animate-breathe" />;
  }
  if (isInProgress(status)) {
    return <span className="size-[11px] shrink-0 rounded-full border-2 border-dashed border-current animate-turn" />;
  }
  if (status === "failed") return <span className="size-2 shrink-0 rotate-45 rounded-[2px] bg-current" />;
  if (!(status in STATUS_LABELS)) {
    return <span className="grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px] border-current text-[10px] leading-none font-bold">?</span>;
  }
  return <span className="size-2 shrink-0 rounded-full bg-current" />;
}

// A status as a word in a tinted pill, never color alone.
export function StatusPill({ status, size = "md", className }: { status: string; size?: "md" | "sm"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap leading-none",
        size === "md" ? "h-[30px] gap-2 pr-3 pl-2.5 text-sm" : "h-7 gap-[7px] pr-[11px] pl-[9px] text-[13px]",
        TONE[status] ?? "bg-s-end-bg text-s-end-ink",
        className,
      )}
    >
      <span aria-hidden="true" className="contents"><Dot status={status} /></span>
      {statusLabel(status)}
    </span>
  );
}
