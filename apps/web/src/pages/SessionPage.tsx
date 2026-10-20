import { ArrowLeft, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useOrgQuery, type OrgQuery } from "../api/ApiProvider.tsx";
import { ApiError } from "../api/client.ts";
import type { SessionView } from "../api/schemas.ts";
import { SignedInShell } from "../auth/SignedInShell.tsx";
import { Button } from "../components/Button.tsx";
import { DraftToAgreed } from "../components/Mark.tsx";
import { PageState } from "../components/PageState.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { isInProgress, StatusPill } from "../components/StatusPill.tsx";
import { usePageTitle } from "../hooks/usePageTitle.ts";
import { cn } from "../lib/cn.ts";
import { exactTime, limitsText, statusExplanation } from "../sessions/detail.ts";
import { ErrorNotice } from "../sessions/ErrorNotice.tsx";
import { meetingDisplay } from "../sessions/meeting.ts";
import { RefreshFailed } from "../sessions/SessionsList.tsx";
import { StageLink } from "../sessions/StageLink.tsx";
import { startedWhen } from "../sessions/time.ts";

// A session's page (plan: "Session detail"): its status and what it means, the meeting, its times and limits, an error
// code for support, and the stage link behind "Show". From GET /v1/sessions/:id, for the active org only; switching org
// goes back to the list (RequireOrg). Refresh reloads it; nothing polls yet (WD6).
export function SessionPage({ now }: { now?: Date }) {
  const { id = "" } = useParams();
  const query = useOrgQuery((api, signal) => api.getSession(id, signal), id);
  const session = query.data;
  usePageTitle(session ? meetingDisplay(session.meetingUrl).code : "Session");

  const back = (
    <Link to="/" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 font-semibold text-ink-2 no-underline transition-colors hover:text-ink">
      <ArrowLeft aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />Sessions
    </Link>
  );

  const notFound = query.status === "error" && query.error instanceof ApiError && query.error.code === "not_found";
  if (notFound || (query.status === "error" && !session)) {
    // No such session (or another org's, or gone since it loaded): a whole-page state with the way back. Nothing of the
    // session stays on screen, its stage link included.
    if (notFound) {
      return (
        <SignedInShell>
          <PageState icon={<DraftToAgreed />} title="No such session in this organization."
            action={<Button asChild variant="secondary"><Link to="/"><ArrowLeft aria-hidden="true" />Back to sessions</Link></Button>}>
            <p className="m-0">It may be in another organization. Switch organization to look there.</p>
          </PageState>
        </SignedInShell>
      );
    }
    return (
      <SignedInShell>
        {back}
        <h1 className="sr-only">Session</h1>
        <ErrorNotice error={query.error} context="detail" onRefresh={query.refresh} refreshing={query.refreshing} className="mt-4 max-w-[560px]" />
      </SignedInShell>
    );
  }

  return (
    <SignedInShell>
      {back}
      {session ? <Loaded session={session} query={query} now={now} /> : <Loading />}
    </SignedInShell>
  );
}

function Loaded({ session, query, now }: { session: SessionView; query: OrgQuery<SessionView>; now: Date | undefined }) {
  const meeting = meetingDisplay(session.meetingUrl);
  const explanation = statusExplanation(session.status);
  const limits = limitsText(session.limits);
  return (
    <>
      <header className="mt-3 flex items-start justify-between gap-x-4 sm:gap-x-6">
        <div className="min-w-0">
          <h1 className={cn(
            "tabular m-0 text-title font-semibold tracking-[-0.03em] break-words lg:text-title-lg",
            isInProgress(session.status) && "underline decoration-primary/60 decoration-dashed decoration-2 underline-offset-[10px]",
          )}>
            {meeting.code}
          </h1>
          <p className="mt-2 mb-0 text-ink-2">{meeting.platformLabel}, started {startedWhen(session.createdAt, now)}</p>
        </div>
        {/* Beside the title at every width; on narrow phones only its icon shows, with "Refresh" as its name. */}
        <Button variant="quiet" size="sm" onClick={query.refresh} busy={query.refreshing}
          className="group shrink-0 max-[480px]:w-11 max-[480px]:px-0">
          <RotateCw aria-hidden="true" className="group-aria-busy:hidden" />
          <span className="max-[480px]:sr-only">{query.refreshing ? "Refreshing…" : "Refresh"}</span>
        </Button>
      </header>

      {query.status === "error" && !query.refreshing && (
        <RefreshFailed error={query.error} loadedAt={query.loadedAt} what="the details" context="detail" className="mt-4 mb-0" />
      )}

      <section aria-label="Status" className="mt-6 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <StatusPill status={session.status} />
        {explanation && <p className="m-0 text-ink">{explanation}</p>}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-16">
        <section aria-labelledby="details">
          <h2 id="details" className="m-0 mb-1 text-label font-semibold text-ink-2">Details</h2>
          <dl className="m-0">
            <Detail term="Meeting link"><span className="break-all">{session.meetingUrl}</span></Detail>
            <Detail term="Started">{exactTime(session.createdAt)}</Detail>
            <Detail term="Last updated">{exactTime(session.updatedAt)}</Detail>
            <Detail term="Spending limit">{limits.spend}</Detail>
            <Detail term="Time limit">{limits.time}</Detail>
            {session.errorCode && (
              <Detail term="Error code" hint="for support">
                <code className="rounded-md bg-sunk px-2 py-0.5 font-mono text-sm">{session.errorCode}</code>
              </Detail>
            )}
          </dl>
        </section>
        <div className="lg:[@media(min-height:640px)]:sticky lg:[@media(min-height:640px)]:top-8">
          <StageLink stageUrl={session.stageUrl} />
        </div>
      </div>
    </>
  );
}

// One fact: the term above its value on phones, beside it from 768px.
function Detail({ term, hint, children }: { term: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-hair py-3.5 first:border-t-0 md:grid-cols-[180px_minmax(0,1fr)] md:items-baseline md:gap-6">
      <dt className="text-sm font-semibold text-ink-2">{term}{hint && <span className="font-normal text-ink-3"> ({hint})</span>}</dt>
      <dd className="m-0 min-w-0 text-ink">{children}</dd>
    </div>
  );
}

// The page's shape while it loads, so nothing jumps when the data arrives.
function Loading() {
  return (
    <>
    <h1 className="sr-only">Session</h1>
    <div role="status" aria-label="Loading session" className="motion-safe:animate-in motion-safe:fade-in motion-safe:delay-150 motion-safe:fill-mode-both">
      <div aria-hidden="true">
        <Skeleton className="mt-4 h-9 w-[min(22rem,70%)] lg:h-12" />
        <Skeleton className="mt-3 h-4 w-48" />
        <Skeleton className="mt-7 h-[30px] w-36 rounded-full" />
        <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
          <div className="grid content-start gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full max-w-[560px]" />)}
          </div>
          <Skeleton className="h-48 rounded-panel" />
        </div>
      </div>
    </div>
    </>
  );
}
