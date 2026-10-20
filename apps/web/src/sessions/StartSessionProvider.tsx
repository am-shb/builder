import { useAuth, useOrganization } from "@clerk/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApi } from "../api/ApiProvider.tsx";
import { ApiError } from "../api/client.ts";
import { explainError } from "../api/errors.ts";
import { isLinkProblem, type StartOrg, type StartResult } from "./start.ts";

export type StartSession = {
  // Starts a session for the link. Resolves with the outcome, or null when a start is already running.
  start: (meetingUrl: string) => Promise<StartResult | null>;
  sending: boolean;
  // The last outcome, until the next start or until put away.
  result: StartResult | null;
  dismiss: () => void;
  // The link in the field. Kept here, not in the form, so it survives closing the sheet, a change of layout and a
  // visit to another page.
  draft: string;
  setDraft: (value: string) => void;
  // Counts finished starts, so the list can reload after each one.
  settled: number;
  // The last outcome hasn't been told to a screen reader yet (it may have arrived while another page was open).
  unannounced: boolean;
  markAnnounced: () => void;
};

const StartContext = createContext<StartSession | null>(null);

// Starting a session, for every page of the signed-in app. It lives above the pages, so leaving the list while a start
// runs doesn't lose its outcome: the warning that a bot may be in the meeting is still there on return.
// One request at a time, never aborted (not even by an org switch) and never retried: aborting turns a known outcome
// into an unknown one, and a retry can send a second paid bot (ADR 0010, ADR 0012).
export function StartSessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { orgId } = useAuth();
  const { organization } = useOrganization();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);
  const [draft, setDraft] = useState("");
  const [settled, setSettled] = useState(0);
  const [unannounced, setUnannounced] = useState(false);
  const inFlight = useRef(false);

  // Closing or reloading the tab while a start runs would turn a known outcome into an unknown one: ask the browser to
  // warn. Moving between the app's own pages is safe, since the start carries on here.
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [sending]);

  const start = useCallback(async (meetingUrl: string): Promise<StartResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSending(true);
    setResult(null);
    setUnannounced(false);
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
    // A link problem is announced by the field itself.
    setUnannounced(!isLinkProblem(outcome));
    // A reply about the link keeps it in the field to fix; anything else empties the field, so a link whose start may
    // have sent a bot isn't one click from a second one.
    if (!isLinkProblem(outcome)) setDraft("");
    setSettled((n) => n + 1);
    return outcome;
  }, [api, orgId, organization?.name]);

  const dismiss = useCallback(() => {
    setResult(null);
    setUnannounced(false);
  }, []);
  const markAnnounced = useCallback(() => setUnannounced(false), []);
  const value = useMemo(
    () => ({ start, sending, result, dismiss, draft, setDraft, settled, unannounced, markAnnounced }),
    [start, sending, result, dismiss, draft, settled, unannounced, markAnnounced],
  );
  return <StartContext.Provider value={value}>{children}</StartContext.Provider>;
}

export function useStartSession(): StartSession {
  const value = useContext(StartContext);
  if (!value) throw new Error("useStartSession needs a StartSessionProvider");
  return value;
}
