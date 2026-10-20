import { useAuth, useOrganization } from "@clerk/react";
import { useCallback, useRef, useState } from "react";
import { useApi } from "../api/ApiProvider.tsx";
import { ApiError } from "../api/client.ts";
import { explainError, type ExplainedError } from "../api/errors.ts";
import type { SessionView } from "../api/schemas.ts";

// Every result keeps the link it was for, so a second start for the same link after an unknown outcome asks first
// (WD8) even when the list couldn't reload.
export type StartResult =
  | { kind: "started"; session: SessionView; org: StartOrg; meetingUrl: string }
  | { kind: "reused"; session: SessionView; org: StartOrg; meetingUrl: string }
  | { kind: "failed"; explained: ExplainedError; code: string; session: SessionView | undefined; org: StartOrg; meetingUrl: string };

// The org a start was sent for, so its result can name it if the person switched org while it ran.
export type StartOrg = { id: string | null | undefined; name: string | undefined };

// Starting a session. One request at a time, never aborted (not even by an org switch) and never retried: aborting
// turns a known outcome into an unknown one, and a retry can send a second paid bot (ADR 0010, ADR 0012). After every
// outcome the list reloads, so a new or saved session shows up.
export function useStartSession(onSettled: () => void) {
  const api = useApi();
  const { orgId } = useAuth();
  const { organization } = useOrganization();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);
  const inFlight = useRef(false);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const start = useCallback(async (meetingUrl: string): Promise<StartResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSending(true);
    setResult(null);
    const org: StartOrg = { id: orgId, name: organization?.name };
    let outcome: StartResult;
    try {
      const reply = await api.createSession(meetingUrl);
      outcome = reply.reused ? { kind: "reused", session: reply.session, org, meetingUrl } : { kind: "started", session: reply.session, org, meetingUrl };
    } catch (err) {
      outcome = {
        kind: "failed",
        explained: explainError(err, "start"),
        code: err instanceof ApiError ? err.code : "network_error",
        session: err instanceof ApiError ? err.session : undefined,
        org,
        meetingUrl,
      };
    }
    inFlight.current = false;
    setSending(false);
    setResult(outcome);
    settled.current();
    return outcome;
  }, [api, orgId, organization?.name]);

  return { start, sending, result, dismiss: useCallback(() => setResult(null), []) };
}
