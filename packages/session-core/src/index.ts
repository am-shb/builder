// What the web and mobile apps share about sessions: how to call the api and read its replies, every error in our own
// words, the rules for starting a session, the words on a session's page, how a meeting link is shown, relative times,
// the status labels, and the product's names. Framework-free: no React, no DOM, no React Native. Each app keeps its own
// screens, hooks and components (ADR 0004: shared only because two apps import it; ADR 0016).
export { BOT_NAME, PRODUCT_NAME } from "./brand.ts";
export { ApiError, createApiClient, isAbort, type ApiClient, type ClientCode } from "./client.ts";
export { CreateSessionResponse, ErrorBody, MeResponse, SessionList, SessionResponse, SessionView } from "./schemas.ts";
export { engineRefusal, explainError, roleLabel, type ErrorAction, type ErrorContext, type ExplainedError } from "./errors.ts";
export {
  ACTIVE_MARGIN_MS, ACTIVE_STATUSES, checkMeetingLink, findActiveCopy, findUnconfirmedStart, isLinkProblem, linkProblemText,
  mayStillChange, meetingKey, outcomeAnnouncement, sameMeetingLink, shouldConfirmStart, startConfirmation, UNCONFIRMED_WINDOW_MS,
  type StartConfirmation, type StartOrg, type StartResult,
} from "./start.ts";
export {
  ENDED_REASONS, exactTime, FAILED_REASONS, limitsText, safeStageUrl, STATUS_EXPLANATIONS, statusExplanation, UNKNOWN_STATUS_EXPLANATION,
} from "./detail.ts";
export { meetingDisplay, type MeetingDisplay } from "./meeting.ts";
export { startedWhen } from "./time.ts";
export { isInProgress, isKnownStatus, STATUS_LABELS, statusLabel } from "./status.ts";
export { apiOrigin, clerkFrontendApiHost, parseUrl } from "./settings.ts";
