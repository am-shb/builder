// The session page's words and checks, as plain functions (plan: "Session detail", "Status labels", "Stage link").
import type { SessionLimits } from "@builder/contracts";
import { BOT_NAME } from "../brand.ts";

// The one-line explanation under the status. Ended has none; a status this page doesn't know says so plainly.
const EXPLANATIONS: Record<string, string> = {
  starting: `We're asking ${BOT_NAME} to join.`,
  joining: `${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`,
  in_meeting: `${BOT_NAME} is in the meeting.`,
  ended: "",
  failed: `${BOT_NAME} left the meeting because of an error.`,
  start_failed: "The meeting service refused. Check the link and try again.",
  start_unknown: `We couldn't confirm whether ${BOT_NAME} joined. Check the meeting before starting again.`,
};

export function statusExplanation(status: string): string {
  return Object.hasOwn(EXPLANATIONS, status) ? EXPLANATIONS[status]! : "This page doesn't know this status yet. Refresh later.";
}

// The stage link, only if it is one we can show as a link: https, or http on the local dev server (the local engine).
// Anything else (javascript:, data:, a broken value) is never rendered, so a bad value can't become a script link.
export function safeStageUrl(raw: string | undefined, { dev = false } = {}): string | null {
  if (!raw || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol === "https:" || (dev && url.protocol === "http:")) return url.href;
  return null;
}

// "Oct 20, 2026, 3:02 PM": an exact time, next to the relative one.
export function exactTime(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// The limits as people read them: "$5.00" and "60 minutes".
export function limitsText(limits: SessionLimits, locale?: string): { spend: string; time: string } {
  const spend = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(limits.maxUsd);
  const minutes = limits.maxMinutes;
  const time = minutes === 1 ? "1 minute" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes)} minutes`;
  return { spend, time };
}
