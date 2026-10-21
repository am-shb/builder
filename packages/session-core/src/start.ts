// The start flow's rules, as plain functions: checking a link, telling whether two links are the same meeting, when to
// ask before starting again (WD8), and which outcomes are about the link itself.
import type { ExplainedError } from "./errors.ts";
import type { SessionView } from "./schemas.ts";
import { parseUrl } from "./settings.ts";

// Every result keeps the link it was for, so a second start for the same meeting after an unknown outcome asks first
// (WD8) even when the list couldn't reload.
export type StartResult =
  | { kind: "started"; session: SessionView; org: StartOrg; meetingUrl: string }
  | { kind: "reused"; session: SessionView; org: StartOrg; meetingUrl: string }
  | { kind: "failed"; explained: ExplainedError; code: string; session: SessionView | undefined; org: StartOrg; meetingUrl: string };

// The org a start was sent for, so its result can name it if the person switched org while it ran.
export type StartOrg = { id: string | null | undefined; name: string | undefined };

// The browser only checks that the link is an https URL; which meeting hosts are allowed is the api's rule, kept in
// one place (plan: "Start form"). The api's 400 covers the rest.
export function checkMeetingLink(input: string): string | null {
  const url = parseUrl(input.trim());
  if (!url) return null;
  return url.protocol === "https:" ? url.href : null;
}

// Which meeting a link is for, so copies of one link compare equal: the query and fragment (?authuser=0, ?pwd=…, #…),
// a trailing slash, the case of a Meet code and a Zoom subdomain don't change the meeting. Only used to decide when to
// ask first, so a match that's too eager costs one extra question, never a bot. The api and engine match exact links
// today; a shared key for them is a separate decision (ADR draft "shared meeting key").
export function meetingKey(link: string): string {
  const u = parseUrl(link);
  if (!u) return link.trim();
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  if (host === "meet.google.com") {
    const code = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/i.exec(path)?.[1];
    if (code) return `meet:${code.toLowerCase()}`;
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const id = /^\/(?:j|s|w|wc|wc\/join)\/(\d{9,12})(?:\/|$)/.exec(path)?.[1];
    if (id) return `zoom:${id}`;
  }
  return `${host}${path}`;
}

export function sameMeetingLink(a: string, b: string): boolean {
  return meetingKey(a) === meetingKey(b);
}

// WD8: a start for this meeting that didn't confirm, in the last 30 minutes. The engine already refuses a second bot
// for the same org and link in nearly every case; this asks first, as a second line of defense.
export const UNCONFIRMED_WINDOW_MS = 30 * 60_000;

export function findUnconfirmedStart(sessions: readonly SessionView[], meetingUrl: string, now = new Date()): SessionView | undefined {
  const target = meetingKey(meetingUrl);
  return sessions.find((s) => s.status === "start_unknown"
    && meetingKey(s.meetingUrl) === target
    && now.getTime() - new Date(s.createdAt).getTime() <= UNCONFIRMED_WINDOW_MS);
}

// A session for this meeting that may still have its bot there, under another copy of the link (?authuser=0, a
// different case): the api and engine match exact links, so starting this copy would send a second bot. The exact
// same link isn't one: the api answers with the existing session and sends nothing. Starting, joining and in the
// meeting count until the session's time limit has passed, plus 30 minutes (the wait in the meeting's lobby, then
// the leave): this app's estimate of when the engine has ended the bot. Statuses move with the engine's events (A2),
// so this only matters when one is missed. The api's start guards use the same default margin (ACTIVE_MARGIN_MINUTES).
export const ACTIVE_STATUSES: readonly string[] = ["starting", "joining", "in_meeting"];
export const ACTIVE_MARGIN_MS = 30 * 60_000;

// A session whose status may still change: starting, joining, in the meeting, or an unconfirmed start (which the
// engine's events can still resolve), within its time limit plus the margin. Pages refresh on their own while they
// show one (useAutoRefresh). Past that, nothing is waiting, so a session left at "Joining" by an older api doesn't
// keep a page asking forever.
export function mayStillChange(s: Pick<SessionView, "status" | "createdAt" | "limits">, now = new Date()): boolean {
  return (ACTIVE_STATUSES.includes(s.status) || s.status === "start_unknown")
    && now.getTime() - new Date(s.createdAt).getTime() <= s.limits.maxMinutes * 60_000 + ACTIVE_MARGIN_MS;
}

export function findActiveCopy(sessions: readonly SessionView[], meetingUrl: string, now = new Date()): SessionView | undefined {
  const target = meetingKey(meetingUrl);
  return sessions.find((s) => ACTIVE_STATUSES.includes(s.status)
    && s.meetingUrl !== meetingUrl
    && meetingKey(s.meetingUrl) === target
    && now.getTime() - new Date(s.createdAt).getTime() <= s.limits.maxMinutes * 60_000 + ACTIVE_MARGIN_MS);
}

// Why to ask before starting this link, or null to start it:
// - "unconfirmed": the last start for the same meeting may have sent a bot, or the list shows an unconfirmed start (WD8);
// - "active": the list shows a session for the same meeting, under another copy of the link, that may still be there.
export type StartConfirmation = { kind: "unconfirmed" } | { kind: "active"; session: SessionView } | null;

export function startConfirmation(last: StartResult | null, sessions: readonly SessionView[], meetingUrl: string, now = new Date()): StartConfirmation {
  const unknownBefore = last?.kind === "failed" && last.explained.botMayExist && sameMeetingLink(last.meetingUrl, meetingUrl);
  if (unknownBefore || findUnconfirmedStart(sessions, meetingUrl, now) !== undefined) return { kind: "unconfirmed" };
  // An active session under this exact link means the api reuses it: nothing is sent, so nothing to ask.
  if (sessions.some((s) => ACTIVE_STATUSES.includes(s.status) && s.meetingUrl === meetingUrl)) return null;
  const active = findActiveCopy(sessions, meetingUrl, now);
  return active ? { kind: "active", session: active } : null;
}

export function shouldConfirmStart(last: StartResult | null, sessions: readonly SessionView[], meetingUrl: string, now = new Date()): boolean {
  return startConfirmation(last, sessions, meetingUrl, now) !== null;
}

// Replies about the link itself (the api's 400, or Recall refusing it): shown under the field, where it can be fixed.
// Never a reply that may have sent a bot: that one is a warning above the list.
export function isLinkProblem(result: StartResult | null): boolean {
  return result?.kind === "failed" && result.explained.action === "fix_link" && !result.explained.botMayExist;
}

// The message under the field for a link problem.
export function linkProblemText(result: StartResult | null): string | undefined {
  if (result?.kind !== "failed" || !isLinkProblem(result)) return undefined;
  return [result.explained.title, result.explained.detail].filter(Boolean).join(" ");
}

// What a screen reader hears when a start finishes: the outcome's first lines, as plain text.
export function outcomeAnnouncement(result: StartResult, botName: string, statusLabel: (s: string) => string): string {
  if (result.kind === "started") return `${botName} is joining the meeting. Admit it when it asks to join.`;
  if (result.kind === "reused") return `This meeting already has a ${botName} session. Status: ${statusLabel(result.session.status)}. No second bot was sent.`;
  return [result.explained.title, result.explained.detail].filter(Boolean).join(" ");
}
