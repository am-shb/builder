import type { SessionView } from "../api/schemas.ts";

// The browser only checks that the link is an https URL; which meeting hosts are allowed is the api's rule, kept in
// one place (plan: "Start form"). The api's 400 covers the rest.
export function checkMeetingLink(input: string): string | null {
  const raw = input.trim();
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  return url.protocol === "https:" ? url.href : null;
}

// WD8: a start for this link that didn't confirm, in the last 30 minutes. The engine already refuses a second bot for
// the same org and meeting in nearly every case; this asks first, as a second line of defense.
export const UNCONFIRMED_WINDOW_MS = 30 * 60_000;

export function findUnconfirmedStart(sessions: readonly SessionView[], meetingUrl: string, now = new Date()): SessionView | undefined {
  const target = normalize(meetingUrl);
  return sessions.find((s) => s.status === "start_unknown"
    && normalize(s.meetingUrl) === target
    && now.getTime() - new Date(s.createdAt).getTime() <= UNCONFIRMED_WINDOW_MS);
}

export function sameMeetingLink(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function normalize(url: string): string {
  return URL.canParse(url) ? new URL(url).href : url;
}
