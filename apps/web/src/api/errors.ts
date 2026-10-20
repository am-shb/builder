// Every api error in our own words (plan: "Errors (every api code)"). The UI shows these, never the api's message.
import { BOT_NAME, PRODUCT_NAME } from "../brand.ts";
import { ApiError } from "./client.ts";

// Where the error happened: reading a list or the role, reading one session's page, or starting a session.
export type ErrorContext = "read" | "detail" | "start";

// What the page offers next.
export type ErrorAction =
  | "refresh" // try the read again
  | "sign_in" // a "Sign in again" button (never automatic)
  | "choose_org" // go to /choose-organization
  | "back_to_list" // back to the session list
  | "fix_link" // the meeting link field
  | "view_session" // the session the failed start created
  | "none";

export type ExplainedError = {
  title: string;
  detail?: string;
  tone: "error" | "warning";
  action: ErrorAction;
  // A start that may have sent a bot: show the warning, reload the list, offer no retry.
  botMayExist: boolean;
};

// The start replies that mean no new bot was sent (plan): 200 reused, 400, 401, 403, 404, 405, 413, 415, 502 and 503.
const NO_NEW_BOT = new Set([400, 401, 403, 404, 405, 413, 415, 502, 503]);

const somethingWrong = (code: string) => `Something went wrong (${code}).`;

// The 504 warning: a bot may be in the meeting, so check before starting again.
function unknownOutcome(title = `We couldn't confirm whether ${BOT_NAME} joined.`): ExplainedError {
  return {
    title,
    detail: `Check the meeting for a ${BOT_NAME} bot before trying again.`,
    tone: "warning",
    action: "view_session",
    botMayExist: true,
  };
}

export function explainError(err: unknown, context: ErrorContext): ExplainedError {
  const e = err instanceof ApiError ? err : new ApiError(0, "network_error");
  const start = context === "start";
  const plain = (title: string, action: ErrorAction = "none", detail?: string): ExplainedError =>
    ({ title, ...(detail ? { detail } : {}), tone: "error", action, botMayExist: false });

  // The web app's own codes.
  if (e.code === "signed_out") return plain("Your sign-in has expired.", "sign_in");
  if (e.code === "network_error") {
    return start
      ? { ...unknownOutcome("We lost the connection while starting."), detail: "Check the session list and the meeting before trying again." }
      : plain(`Can't reach ${PRODUCT_NAME}. Check your connection.`, "refresh");
  }
  if (e.code === "bad_response") return start ? unknownOutcome() : plain(somethingWrong("bad_response"), "refresh");

  // A start that may have reached the engine: unless the reply proves no bot was sent, warn.
  if (start && !NO_NEW_BOT.has(e.status)) return unknownOutcome();

  switch (e.code) {
    case "invalid_request":
      return plain("Use an https Google Meet, Zoom or Teams link.", "fix_link");
    case "unauthenticated":
      return plain("Your sign-in has expired or isn't accepted here.", "sign_in",
        "If this keeps happening right after you sign in, contact support.");
    case "no_active_org":
      return plain("Choose an organization to continue.", "choose_org");
    case "forbidden":
      return plain("Your role in this organization can't do that.");
    case "not_found":
      return context === "detail" ? plain("No such session in this organization.", "back_to_list") : plain(somethingWrong("not_found"));
    case "internal_error":
      return plain("Something went wrong on our side. Try again in a moment.", "refresh");
    case "auth_unavailable":
      return plain("Sign-in isn't available right now.", "refresh");
    case "db_unavailable":
      return plain("Sessions aren't available right now.", "refresh");
    case "engine_unavailable":
      return plain("Starting meetings isn't available right now.", "none", "Nothing was started.");
    case "limits_unavailable":
      return plain("Starting meetings isn't set up on this server yet.", "none", "Nothing was started.");
    case "engine_rejected": {
      const engineCode = e.session?.errorCode;
      if (engineCode === "recall_rejected") {
        return plain(`${BOT_NAME} couldn't join this meeting.`, "fix_link", "Check the link and that the meeting is open, then try again.");
      }
      if (engineCode === "meeting_in_use") {
        return { ...plain(`${BOT_NAME} already has a session in this meeting.`, "back_to_list", "Check the meeting."), tone: "warning" };
      }
      return plain(`Starting meetings isn't working right now (${engineCode ?? "engine_rejected"}).`);
    }
    default:
      return context === "read" || context === "detail" ? plain(somethingWrong(e.code), "refresh") : plain(somethingWrong(e.code));
  }
}

// Org roles as people read them; any other role shows as its key.
export function roleLabel(role: string): string {
  if (role === "org:admin") return "Admin";
  if (role === "org:member") return "Member";
  return role;
}
