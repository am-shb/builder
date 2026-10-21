import { useAuth, useOrganization } from "@clerk/expo";
import { ApiError, explainError, isLinkProblem, type StartOrg, type StartResult } from "@builder/session-core";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useApi } from "../api/ApiProvider.tsx";

export type StartSession = {
  // Starts a session for the link. Resolves with the outcome, or null when a start is already running.
  start: (meetingUrl: string) => Promise<StartResult | null>;
  sending: boolean;
  // The last outcome, until the next start or until put away.
  result: StartResult | null;
  dismiss: () => void;
  // The link in the field, kept here so it survives closing the sheet and a visit to another screen.
  draft: string;
  setDraft: (value: string) => void;
  // Counts finished starts, so the list can reload after each one.
  settled: number;
};

const StartContext = createContext<StartSession | null>(null);

// Starting a session, for every screen of the signed-in app. It lives above the screens, so leaving the list while a
// start runs doesn't lose its outcome. One request at a time, never aborted (not even by an org switch) and never
// retried: aborting turns a known outcome into an unknown one, and a retry can send a second paid bot (ADR 0010).
export function StartSessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { orgId } = useAuth();
  const { organization } = useOrganization();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);
  const [draft, setDraft] = useState("");
  const [settled, setSettled] = useState(0);
  const inFlight = useRef(false);

  const start = useCallback(async (meetingUrl: string): Promise<StartResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSending(true);
    setResult(null);
    const org: StartOrg = { id: orgId, name: organization?.name };
    let outcome: StartResult;
    try {
      const reply = await api.createSession(meetingUrl);
      outcome = { kind: reply.reused ? "reused" : "started", session: reply.session, org, meetingUrl };
    } catch (err) {
      outcome = {
        kind: "failed",
        explained: explainError(err, "start"),
        code: err instanceof ApiError ? err.code : "unexpected",
        session: err instanceof ApiError ? err.session : undefined,
        org,
        meetingUrl,
      };
    }
    inFlight.current = false;
    setSending(false);
    setResult(outcome);
    // A reply about the link keeps it in the field to fix; anything else empties the field, so a link whose start may
    // have sent a bot isn't one tap from a second one.
    if (!isLinkProblem(outcome)) setDraft("");
    setSettled((n) => n + 1);
    return outcome;
  }, [api, orgId, organization?.name]);

  const dismiss = useCallback(() => setResult(null), []);
  const value = useMemo(() => ({ start, sending, result, dismiss, draft, setDraft, settled }), [start, sending, result, dismiss, draft, settled]);
  return <StartContext.Provider value={value}>{children}</StartContext.Provider>;
}

export function useStartSession(): StartSession {
  const value = useContext(StartContext);
  if (!value) throw new Error("useStartSession needs a StartSessionProvider");
  return value;
}
