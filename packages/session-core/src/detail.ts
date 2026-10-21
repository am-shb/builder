// The session page's words and checks, as plain functions (plan: "Session detail", "Status labels", "Stage link").
import type { SessionLimits } from "@builder/contracts";
import { engineRefusal } from "./errors.ts";
import { BOT_NAME } from "./brand.ts";

// The one-line explanation under the status. Ended has none; a status this page doesn't know says so plainly.
// "Didn't start" depends on why: the engine's error code, worded as the start's reply worded it.
export const STATUS_EXPLANATIONS: Record<string, string> = {
  starting: `We're asking ${BOT_NAME} to join.`,
  joining: `${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`,
  in_meeting: `${BOT_NAME} is in the meeting.`,
  ended: "",
  failed: `${BOT_NAME} left the meeting because of an error.`,
  start_failed: "The meeting service refused. Check the link and try again.",
  start_unknown: `We couldn't confirm whether ${BOT_NAME} joined. Check the meeting before starting again.`,
};

export const UNKNOWN_STATUS_EXPLANATION = "This page doesn't know this status yet. Refresh later.";

// Why a session ended, from the engine's status event (A2): its own limits, or Recall's reason for the bot leaving
// (docs.recall.ai, "Call Ended Sub Codes"). A reason not listed here shows nothing, as an ended session did before.
export const ENDED_REASONS: Record<string, string> = {
  max_minutes: `${BOT_NAME} left when the session reached its time limit.`,
  max_usd: `${BOT_NAME} left when the session reached its spending limit.`,
  call_ended_by_host: "The host ended the meeting.",
  call_ended_by_platform_idle: "The meeting service ended the meeting because it was idle.",
  call_ended_by_platform_max_length: "The meeting service ended the meeting at its length limit.",
  call_ended_by_platform_waiting_room_timeout: `Nobody let ${BOT_NAME} in from the waiting room in time.`,
  timeout_exceeded_waiting_room: `Nobody let ${BOT_NAME} in from the waiting room in time.`,
  bot_kicked_from_waiting_room: `${BOT_NAME} was turned away from the waiting room.`,
  bot_kicked_from_call: `${BOT_NAME} was removed from the meeting.`,
  timeout_exceeded_noone_joined: `${BOT_NAME} left because nobody joined.`,
  timeout_exceeded_everyone_left: `${BOT_NAME} left after everyone else did.`,
  bot_received_leave_call: `${BOT_NAME} was asked to leave.`,
  meeting_not_started: "The meeting hadn't started yet.",
};

// Why a session failed: Recall's reason (docs.recall.ai, "Fatal Sub Codes"). Others get the general line.
export const FAILED_REASONS: Record<string, string> = {
  meeting_not_found: `${BOT_NAME} couldn't find the meeting. Check the link.`,
  meeting_link_invalid: `${BOT_NAME} couldn't find the meeting. Check the link.`,
  meeting_link_expired: "The meeting link has expired.",
  meeting_ended: "The meeting had already ended.",
  meeting_not_started: "The meeting hadn't started yet.",
  meeting_requires_sign_in: `The meeting only lets signed-in people join, so ${BOT_NAME} couldn't.`,
  meeting_requires_registration: `The meeting requires registration, so ${BOT_NAME} couldn't join.`,
  meeting_not_accessible: `The meeting's access settings didn't let ${BOT_NAME} join.`,
  meeting_password_incorrect: "The meeting's passcode didn't work.",
  meeting_locked: "The meeting is locked.",
  meeting_full: "The meeting is full.",
};

export function statusExplanation(status: string, errorCode?: string): string {
  if (status === "start_failed" && errorCode) {
    const r = engineRefusal(errorCode);
    return [r.title, r.detail].filter(Boolean).join(" ");
  }
  if (status === "ended" && errorCode && Object.hasOwn(ENDED_REASONS, errorCode)) return ENDED_REASONS[errorCode]!;
  if (status === "failed" && errorCode && Object.hasOwn(FAILED_REASONS, errorCode)) return FAILED_REASONS[errorCode]!;
  return Object.hasOwn(STATUS_EXPLANATIONS, status) ? STATUS_EXPLANATIONS[status]! : UNKNOWN_STATUS_EXPLANATION;
}

// The stage link, only if it is one we can show as a link: https, or http on the local dev server (the local engine).
// Anything else (javascript:, data:, a broken value) is never rendered, so a bad value can't become a script link.
export function safeStageUrl(raw: string | undefined, { dev = false } = {}): string | null {
  if (!raw || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol === "https:" || (dev && url.protocol === "http:")) return url.href;
  return null;
}

// "Oct 20, 2026, 3:02 PM EDT": an exact time, next to the relative one. With its time zone, so it can be compared with
// a support log or a teammate elsewhere.
export function exactTime(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

// The limits as people read them: "$5.00" and "60 minutes".
export function limitsText(limits: SessionLimits, locale?: string): { spend: string; time: string } {
  const spend = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(limits.maxUsd);
  const minutes = limits.maxMinutes;
  const time = minutes === 1 ? "1 minute" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes)} minutes`;
  return { spend, time };
}
