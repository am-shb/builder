// The api's one door to the shapes it shares with the engine and the web app (ADR 0004).
export type { EngineEvent, StartSessionRequest, StartSessionResponse } from "@builder/contracts";
export { EngineEvent as EngineEventSchema, parseEngineEvent } from "@builder/contracts";
