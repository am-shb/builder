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
import { statusLabel } from "../components/StatusPill.tsx";
import { usePageTitle } from "../hooks/usePageTitle.ts";
import { SessionsList } from "../sessions/SessionsList.tsx";
import { isLinkProblem, linkProblemText, outcomeAnnouncement, shouldConfirmStart } from "../sessions/start.ts";
import { StartForm } from "../sessions/StartForm.tsx";
import { StartOutcome } from "../sessions/StartOutcome.tsx";
import { useStartSession } from "../sessions/StartSessionProvider.tsx";

type Announcement = { text: string; urgent: boolean };

// The sessions page: start a session (the panel on wide screens; a sticky button and a sheet or dialog below 1024px)
// and the org's sessions. A start's outcome shows above the list until the next start or until put away.
export function HomePage({ now }: { now?: Date }) {
  usePageTitle("Sessions");
  const { orgId } = useAuth();
  const list = useOrgQuery((api, signal) => api.listSessions(signal));
  const starter = useStartSession();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Until the sheet has finished closing, the rest of the page is hidden from screen readers.
  const [sheetMounted, setSheetMounted] = useState(false);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;
  // WD8: a link waiting for "Start anyway".
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const newSessionRef = useRef<HTMLButtonElement>(null);
  const linkError = linkProblemText(starter.result);

  // The list reloads after every start, so a new or saved session shows up.
  const { refresh } = list;
  const settledSeen = useRef(starter.settled);
  useEffect(() => {
    if (starter.settled === settledSeen.current) return;
    settledSeen.current = starter.settled;
    refresh();
  }, [starter.settled, refresh]);

  // One way to tell a screen reader about an outcome: a short message in a live region (focus stays where it is). It
  // waits until the sheet has closed, and an outcome that arrived while another page was open is told on return.
  // The region is emptied first, so the same message twice is still announced; a message put away before it was
  // shown (Dismiss, or a new start) is dropped.
  const announceSeq = useRef(0);
  const { result: outcome, unannounced, markAnnounced } = starter;
  useEffect(() => {
    if (!outcome) {
      announceSeq.current += 1;
      setAnnouncement(null);
      return;
    }
    if (!unannounced || sheetMounted) return;
    markAnnounced();
    const message = { text: outcomeAnnouncement(outcome, BOT_NAME, statusLabel), urgent: outcome.kind === "failed" };
    const seq = ++announceSeq.current;
    setAnnouncement(null);
    requestAnimationFrame(() => {
      if (seq === announceSeq.current) setAnnouncement(message);
    });
  }, [outcome, unannounced, sheetMounted, markAnnounced]);

  async function send(url: string) {
    const result = await starter.start(url);
    // A link problem keeps the sheet open to fix it; anything else closes it.
    if (result && !isLinkProblem(result) && sheetOpenRef.current) setSheetOpen(false);
  }

  function requestStart(url: string) {
    if (shouldConfirmStart(starter.result, list.data ?? [], url, now)) setConfirmUrl(url);
    else void send(url);
  }

  const formProps = {
    value: starter.draft,
    onValueChange: (value: string) => {
      starter.setDraft(value);
      // Editing the link puts away the reply about it.
      if (linkError) starter.dismiss();
    },
    onStart: requestStart,
    sending: starter.sending,
    error: linkError,
  };
  const openSheet = () => {
    setSheetMounted(true);
    setSheetOpen(true);
  };
  // Where focus goes when the element that opened a dialog can't take it back (Safari doesn't focus a clicked button):
  // the visible Start button, or New session.
  const visibleStart = () => [...document.querySelectorAll<HTMLElement>("form button[type=submit]")].find((b) => b.offsetParent !== null)
    ?? newSessionRef.current;
  const newSession = <Button ref={newSessionRef} block onClick={openSheet}><Plus aria-hidden="true" />New session</Button>;
  const empty = list.status === "ready" && (list.data ?? []).length === 0;
  const result = starter.result && !isLinkProblem(starter.result) ? starter.result : null;

  return (
    <SignedInShell actionBar={empty ? undefined : newSession}>
      <SplitLayout
        intro={<PageIntro title="Sessions" subtitle={`Send ${BOT_NAME} into a meeting, then follow each session here.`} />}
        panel={<StartForm {...formProps} />}
      >
        {/* Always mounted, so a new message is announced: one region for news, one for problems. */}
        <div role="status" className="sr-only">{announcement && !announcement.urgent ? announcement.text : null}</div>
        <div role="alert" className="sr-only">{announcement?.urgent ? announcement.text : null}</div>
        {result && (
          <div className="mb-5 lg:mt-3.5 lg:mb-6" data-testid="start-outcome">
            <StartOutcome result={result} currentOrgId={orgId} onDismiss={starter.dismiss} />
          </div>
        )}
        <SessionsList list={list} now={now} emptyAction={newSession} />
      </SplitLayout>
      <ResponsiveModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="New session"
        closeDisabled={starter.sending}
        returnFocusTo={() => newSessionRef.current}
        onClosed={() => setSheetMounted(false)}
      >
        <StartForm {...formProps} />
      </ResponsiveModal>
      <ConfirmModal
        open={confirmUrl !== null}
        onOpenChange={(open) => !open && setConfirmUrl(null)}
        title="Start another session for this link?"
        description={`An earlier start for this link didn't confirm. Check the meeting for a ${BOT_NAME} bot before starting another.`}
        confirmLabel="Start anyway"
        returnFocusTo={visibleStart}
        onConfirm={() => {
          const url = confirmUrl;
          setConfirmUrl(null);
          if (url) void send(url);
        }}
      />
    </SignedInShell>
  );
}
