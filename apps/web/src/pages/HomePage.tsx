import { useAuth } from "@clerk/react";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOrgQuery } from "../api/ApiProvider.tsx";
import { SignedInShell } from "../auth/SignedInShell.tsx";
import { BOT_NAME } from "../brand.ts";
import { PageIntro, SplitLayout } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { ConfirmModal } from "../components/ConfirmModal.tsx";
import { ResponsiveModal } from "../components/ResponsiveModal.tsx";
import { SessionsList } from "../sessions/SessionsList.tsx";
import { findUnconfirmedStart, sameMeetingLink } from "../sessions/start.ts";
import { StartForm } from "../sessions/StartForm.tsx";
import { isLinkProblem, linkProblemText, StartOutcome } from "../sessions/StartOutcome.tsx";
import { useStartSession, type StartResult } from "../sessions/useStartSession.ts";

// The sessions page: start a session (the panel on desktop; a sticky button and a bottom sheet on phones) and the
// org's sessions. A start's outcome shows above the list until the next start or until put away.
export function HomePage({ now }: { now?: Date }) {
  const { orgId } = useAuth();
  const list = useOrgQuery((api, signal) => api.listSessions(signal));
  const starter = useStartSession(list.refresh);
  const [sheetOpen, setSheetOpen] = useState(false);
  // WD8: a link waiting for "Start anyway".
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [clearKey, setClearKey] = useState(0);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const linkError = linkProblemText(starter.result);

  // Leaving the page while a start runs would turn a known outcome into an unknown one: ask the browser to warn.
  useEffect(() => {
    if (!starter.sending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [starter.sending]);

  async function send(url: string) {
    const outcome = await starter.start(url);
    if (!outcome) return;
    // A reply about the link keeps it in the field (and the sheet open) to fix; anything else empties the field, so a
    // link whose start may have sent a bot isn't one click from a second one.
    if (isLinkProblem(outcome)) return;
    setClearKey((k) => k + 1);
    setSheetOpen(false);
    // Focus moves to the outcome, so keyboard and screen-reader users land on what happened.
    requestAnimationFrame(() => outcomeRef.current?.focus());
  }

  function requestStart(url: string) {
    const last: StartResult | null = starter.result;
    const unknownBefore = last?.kind === "failed" && last.explained.botMayExist && sameMeetingLink(last.meetingUrl, url);
    if (unknownBefore || findUnconfirmedStart(list.data ?? [], url, now)) setConfirmUrl(url);
    else void send(url);
  }

  const formProps = { onStart: requestStart, sending: starter.sending, error: linkError, onEdit: linkError ? starter.dismiss : undefined, clearKey };
  const newSession = <Button block onClick={() => setSheetOpen(true)}><Plus aria-hidden="true" />New session</Button>;
  const empty = list.status === "ready" && (list.data ?? []).length === 0;
  const result = starter.result && !isLinkProblem(starter.result) ? starter.result : null;
  const alerting = result?.kind === "failed";

  return (
    <SignedInShell actionBar={empty ? undefined : newSession}>
      <SplitLayout
        intro={<PageIntro title="Sessions" subtitle={`Send ${BOT_NAME} into a meeting, then follow each session here.`} />}
        panel={<StartForm {...formProps} />}
      >
        {/* Always mounted, so a new outcome is announced; one region for news, one for problems. */}
        <div role="status">
          {result && !alerting && (
            <div ref={outcomeRef} tabIndex={-1} className="mb-5 outline-none md:mt-[var(--section-baseline,14px)] md:mb-6">
              <StartOutcome result={result} currentOrgId={orgId} onDismiss={starter.dismiss} />
            </div>
          )}
        </div>
        <div role="alert">
          {result && alerting && (
            <div ref={outcomeRef} tabIndex={-1} className="mb-5 outline-none md:mt-[var(--section-baseline,14px)] md:mb-6">
              <StartOutcome result={result} currentOrgId={orgId} onDismiss={starter.dismiss} />
            </div>
          )}
        </div>
        <SessionsList list={list} now={now} emptyAction={newSession} />
      </SplitLayout>
      <ResponsiveModal open={sheetOpen} onOpenChange={setSheetOpen} title="New session" closeDisabled={starter.sending}>
        <StartForm {...formProps} />
      </ResponsiveModal>
      <ConfirmModal
        open={confirmUrl !== null}
        onOpenChange={(open) => !open && setConfirmUrl(null)}
        title="Start another session for this link?"
        description={`An earlier start for this link didn't confirm. Check the meeting for a ${BOT_NAME} bot before starting another.`}
        confirmLabel="Start anyway"
        onConfirm={() => {
          const url = confirmUrl;
          setConfirmUrl(null);
          if (url) void send(url);
        }}
      />
    </SignedInShell>
  );
}
