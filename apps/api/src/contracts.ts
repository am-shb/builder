// The api's one door to the shapes it shares with the engine and the web app (ADR 0004).
export type { EngineEvent, SessionLimits, SessionStatus, StartSessionRequest, StartSessionResponse } from "@builder/contracts";
export {
  EngineEvent as EngineEventSchema,
  parseEngineEvent,
  StartSessionRequest as StartSessionRequestSchema,
  StartSessionResponse as StartSessionResponseSchema,
} from "@builder/contracts";
