import { CircleAlert, RotateCw } from "lucide-react";
import { Link } from "react-router";
import { useOrgQuery } from "../api/ApiProvider.tsx";
import { explainError } from "../api/errors.ts";
import type { SessionView } from "../api/schemas.ts";
import { BOT_NAME } from "../brand.ts";
import { SectionHeader } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { SessionList, SessionRow, SessionRowSkeleton } from "../components/SessionRow.tsx";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { meetingDisplay } from "./meeting.ts";
import { startedWhen } from "./time.ts";

export const EMPTY_STEPS = ["Paste the meeting link", `Admit ${BOT_NAME} when it asks to join`, "Watch the prototype take shape"];

// The api returns an org's newest 50.
export const LIST_LIMIT = 50;

// The org's sessions, newest first, as the api returns them. Reloaded with Refresh, which is always in the header,
// and when the org changes; statuses don't change on their own yet (plan WD6). No stage link here: it's a control link,
// shown only on a session's own page.
export function SessionsList({ now }: { now?: Date }) {
  const list = useOrgQuery((api, signal) => api.listSessions(signal));
  const header = (
    <SectionHeader id="recent" title="Recent" action={
      <Button variant="quiet" size="sm" onClick={list.refresh} busy={list.refreshing} busyLabel="Refreshing…" disabled={list.status === "loading"}>
        <RotateCw aria-hidden="true" />Refresh
      </Button>
    } />
  );

  if (list.status === "loading") {
    return (
      <section aria-labelledby="recent">
        {header}
        {/* Skeleton rows fade in after 150 ms, so a fast reply shows nothing in between. */}
        <SessionList aria-busy="true" aria-label="Loading sessions"
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:delay-150 motion-safe:fill-mode-both">
          {[0, 1, 2].map((i) => <SessionRowSkeleton key={i} />)}
        </SessionList>
      </section>
    );
  }

  if (list.status === "error" && !list.data) {
    return (
      <section aria-labelledby="recent">
        {header}
        <ErrorNotice error={list.error} context="read" className="mt-2 md:max-w-[520px]" />
      </section>
    );
  }

  const sessions = list.data ?? [];
  return (
    <section aria-labelledby="recent">
      {header}
      {list.status === "error" && <RefreshFailed error={list.error} loadedAt={list.loadedAt} />}
      {sessions.length === 0 ? (
        <EmptyState
          className="mt-2"
          title="Start your first session"
          description={`Bring ${BOT_NAME} into a meeting. It listens while you decide, and builds the prototype on the shared screen.`}
          steps={EMPTY_STEPS}
        />
      ) : (
        <>
          <SessionList>{sessions.map((s) => <Row key={s.id} session={s} now={now} />)}</SessionList>
          {sessions.length >= LIST_LIMIT && <p className="mt-4 mb-0 text-sm text-ink-3">Showing the {LIST_LIMIT} most recent sessions.</p>}
        </>
      )}
    </section>
  );
}

// A refresh failed while the list was on screen: one quiet line, since nothing on screen changed. Errors that need the
// person to act (sign in again, choose an organization) still get the full notice with its button.
function RefreshFailed({ error, loadedAt }: { error: unknown; loadedAt: Date | undefined }) {
  const x = explainError(error, "read");
  if (x.action === "sign_in" || x.action === "choose_org") return <ErrorNotice error={error} context="read" className="mt-2 mb-3" />;
  const when = loadedAt?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <p role="alert" className="mt-1 mb-2 flex items-center gap-2 text-sm font-medium text-danger">
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      Couldn't refresh.{when ? ` Showing the list from ${when}.` : ""}
    </p>
  );
}

function Row({ session, now }: { session: SessionView; now: Date | undefined }) {
  const meeting = meetingDisplay(session.meetingUrl);
  return (
    <SessionRow
      code={meeting.code}
      status={session.status}
      platform={meeting.platform}
      platformLabel={meeting.platformLabel}
      when={startedWhen(session.createdAt, now)}
      renderLink={({ className, children }) => <Link to={`/sessions/${encodeURIComponent(session.id)}`} className={className}>{children}</Link>}
    />
  );
}
