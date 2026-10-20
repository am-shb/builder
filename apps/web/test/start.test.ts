import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client.ts";
import { explainError } from "../src/api/errors.ts";
import {
  checkMeetingLink, findUnconfirmedStart, isLinkProblem, linkProblemText, meetingKey, sameMeetingLink, shouldConfirmStart,
  UNCONFIRMED_WINDOW_MS, type StartResult,
} from "../src/sessions/start.ts";
import { session } from "./helpers/fake-api.ts";

const NOW = new Date("2026-10-20T15:00:00Z");
const LINK = "https://meet.google.com/kfp-qzwd-nre";
const ORG = { id: "org_a", name: "Org A" };
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const failed = (err: ApiError, meetingUrl = LINK): StartResult =>
  ({ kind: "failed", explained: explainError(err, "start"), code: err.code, session: err.session, org: ORG, meetingUrl });

describe("checkMeetingLink", () => {
  it("trims and keeps an https link; refuses anything else", () => {
    expect(checkMeetingLink(`  ${LINK}\n`)).toBe(LINK);
    for (const bad of ["", "meet.google.com/kfp-qzwd-nre", "http://meet.google.com/kfp-qzwd-nre", "javascript:alert(1)", "not a link"]) {
      expect(checkMeetingLink(bad), bad).toBeNull();
    }
  });
});

describe("meetingKey: copies of one meeting's link match, different meetings don't", () => {
  it.each([
    [LINK, "meet:kfp-qzwd-nre"],
    ["https://meet.google.com/KFP-QZWD-NRE/", "meet:kfp-qzwd-nre"],
    ["https://meet.google.com/kfp-qzwd-nre?authuser=0&hs=122#x", "meet:kfp-qzwd-nre"],
    ["https://zoom.us/j/85712345678", "zoom:85712345678"],
    ["https://us02web.zoom.us/j/85712345678?pwd=AbC123", "zoom:85712345678"],
    ["https://acme.zoom.us/wc/85712345678/join?pwd=x", "zoom:85712345678"],
    ["https://zoom.us/wc/join/85712345678", "zoom:85712345678"],
    ["https://teams.microsoft.com/l/meetup-join/19%3ameeting_AbC%40thread.v2/0?context=x", "teams.microsoft.com/l/meetup-join/19%3ameeting_AbC%40thread.v2/0"],
  ])("%s", (link, key) => {
    expect(meetingKey(link)).toBe(key);
  });

  it("keeps meetings apart", () => {
    expect(sameMeetingLink(LINK, "https://meet.google.com/abc-defg-hij")).toBe(false);
    expect(sameMeetingLink("https://zoom.us/j/85712345678", "https://zoom.us/j/85712345679")).toBe(false);
    // Teams ids are case-sensitive.
    expect(sameMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3aAbC%40thread.v2/0", "https://teams.microsoft.com/l/meetup-join/19%3aabc%40thread.v2/0")).toBe(false);
  });

  it("never throws on something that isn't a link", () => {
    expect(meetingKey("  not a link ")).toBe("not a link");
  });
});

describe("findUnconfirmedStart", () => {
  const at = (msAgo: number, over = {}) => session({ id: "u", meetingUrl: LINK, status: "start_unknown", createdAt: ago(msAgo), ...over });

  it("finds an unconfirmed start for the same meeting up to exactly 30 minutes old", () => {
    expect(findUnconfirmedStart([at(UNCONFIRMED_WINDOW_MS)], `${LINK}?authuser=0`, NOW)?.id).toBe("u");
    expect(findUnconfirmedStart([at(UNCONFIRMED_WINDOW_MS + 1)], LINK, NOW)).toBeUndefined();
  });

  it("only counts start_unknown", () => {
    for (const status of ["joining", "in_meeting", "start_failed", "ended", "failed", "starting"]) {
      expect(findUnconfirmedStart([at(60_000, { status })], LINK, NOW), status).toBeUndefined();
    }
  });
});

describe("shouldConfirmStart", () => {
  it("asks after an unknown outcome for the same meeting, even with no list", () => {
    expect(shouldConfirmStart(failed(new ApiError(504, "engine_outcome_unknown")), [], `${LINK}/`, NOW)).toBe(true);
    expect(shouldConfirmStart(failed(new ApiError(0, "network_error")), [], LINK, NOW)).toBe(true);
  });

  it("doesn't ask after an outcome that proves no bot was sent, or for another meeting", () => {
    expect(shouldConfirmStart(failed(new ApiError(503, "engine_unavailable")), [], LINK, NOW)).toBe(false);
    expect(shouldConfirmStart(failed(new ApiError(504, "engine_outcome_unknown"), "https://meet.google.com/abc-defg-hij"), [], LINK, NOW)).toBe(false);
    expect(shouldConfirmStart(null, [], LINK, NOW)).toBe(false);
  });

  it("asks when the list shows a recent unconfirmed start", () => {
    const unconfirmed = session({ meetingUrl: LINK, status: "start_unknown", createdAt: ago(60_000) });
    expect(shouldConfirmStart(null, [unconfirmed], LINK, NOW)).toBe(true);
  });
});

describe("link problems", () => {
  it("the api's 400 and Recall refusing the link go under the field", () => {
    const refused = failed(new ApiError(502, "engine_rejected", session({ status: "start_failed", errorCode: "recall_rejected" })));
    expect(isLinkProblem(failed(new ApiError(400, "invalid_request")))).toBe(true);
    expect(isLinkProblem(refused)).toBe(true);
    expect(linkProblemText(refused)).toMatch(/couldn't join this meeting\. Check the link/);
  });

  it("a reply that may have sent a bot is never a link problem, even with a link code", () => {
    // An invalid_request code on a status that doesn't prove no bot was sent (a 500 here) is the warning.
    const odd = failed(new ApiError(500, "invalid_request"));
    expect(odd.kind === "failed" && odd.explained.botMayExist).toBe(true);
    expect(isLinkProblem(odd)).toBe(false);
    expect(linkProblemText(odd)).toBeUndefined();
  });

  it("successes and other failures aren't link problems", () => {
    expect(isLinkProblem({ kind: "started", session: session(), org: ORG, meetingUrl: LINK })).toBe(false);
    expect(isLinkProblem(failed(new ApiError(503, "engine_unavailable")))).toBe(false);
    expect(isLinkProblem(null)).toBe(false);
  });
});
