// How a meeting shows in the list: its code, set large, and the platform (ADR 0013). The meeting link itself is only
// ever text, never a link of ours (plan: "Safe rendering").
export type MeetingDisplay = { code: string; platform: "meet" | "zoom" | "teams" | "other"; platformLabel: string };

const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

export function meetingDisplay(meetingUrl: string): MeetingDisplay {
  let url: URL;
  try {
    url = new URL(meetingUrl);
  } catch {
    return { code: meetingUrl, platform: "other", platformLabel: "Meeting" };
  }
  const host = url.hostname.toLowerCase();
  if (host === "meet.google.com") {
    // Only a real meeting code (abc-defg-hij); /lookup/... and others show the platform's name.
    const code = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return { code: MEET_CODE.test(code) ? code.toLowerCase() : "Google Meet", platform: "meet", platformLabel: "Google Meet" };
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    // /j/84213377051 or /w/...: the whole meeting ID (9 to 11 digits), grouped the way Zoom shows it.
    const id = url.pathname.match(/\/[jw]\/(\d{9,11})(?:\/|$)/)?.[1];
    return { code: id ? groupZoomId(id) : "Zoom meeting", platform: "zoom", platformLabel: "Zoom" };
  }
  if (host === "teams.microsoft.com" || host === "teams.live.com") {
    // Newer links carry a numeric meeting ID (/meet/<digits>); older meetup-join links have none to show.
    const id = url.pathname.match(/\/meet\/(\d{6,20})(?:\/|$)/)?.[1];
    return { code: id ? groupInThrees(id) : "Teams meeting", platform: "teams", platformLabel: "Teams" };
  }
  return { code: host, platform: "other", platformLabel: "Meeting" };
}

function groupZoomId(id: string): string {
  return id.length === 11 ? `${id.slice(0, 3)} ${id.slice(3, 7)} ${id.slice(7)}` : `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}`;
}

function groupInThrees(id: string): string {
  return id.replace(/(\d{3})(?=\d)/g, "$1 ");
}
