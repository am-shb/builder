import { useClerk } from "@clerk/react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { BOT_NAME } from "../brand.ts";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Callout.tsx";
import { statusLabel } from "../components/StatusPill.tsx";
import type { StartResult } from "./useStartSession.ts";

// What happened to a start, until the next one or until put away (plan: the error table's POST rows). A start that may
// have sent a bot is a persistent warning with no retry; the list has already reloaded.
// Replies about the link itself (the api's 400, or Recall refusing it): shown under the field, where it can be fixed.
export function isLinkProblem(result: StartResult): boolean {
  return result.kind === "failed" && (result.code === "invalid_request" || result.explained.action === "fix_link");
}

// The message under the field for a link problem.
export function linkProblemText(result: StartResult | null): string | undefined {
  if (!result || result.kind !== "failed" || !isLinkProblem(result)) return undefined;
  return result.code === "invalid_request" ? result.explained.title : `${result.explained.title} ${result.explained.detail ?? ""}`.trim();
}

export function StartOutcome({ result, currentOrgId, onDismiss }: {
  result: StartResult;
  currentOrgId: string | null | undefined;
  onDismiss: () => void;
}) {
  const clerk = useClerk();
  // The person switched org while the start ran: say which org it was for, and don't link into the other org.
  const otherOrg = result.org.id !== currentOrgId;
  const inOrg = otherOrg ? <p className="m-0 mt-1 text-sm">This was in {result.org.name ?? "your previous organization"}.</p> : null;
  const view = (id: string, label = "View session") =>
    otherOrg ? null : (
      <Button asChild variant="secondary" size="sm"><Link to={`/sessions/${encodeURIComponent(id)}`}>{label}<ArrowRight aria-hidden="true" /></Link></Button>
    );

  if (result.kind === "started") {
    return (
      <Callout tone="success" title={`${BOT_NAME} is joining the meeting.`} action={view(result.session.id)} onDismiss={onDismiss}>
        <p className="m-0">Admit it when it asks to join.</p>
        {inOrg}
      </Callout>
    );
  }
  if (result.kind === "reused") {
    return (
      <Callout tone="info" title={`This meeting already has a ${BOT_NAME} session.`} action={view(result.session.id)} onDismiss={onDismiss}>
        <p className="m-0">Status: {statusLabel(result.session.status)}. No second bot was sent.</p>
        {inOrg}
      </Callout>
    );
  }

  const x = result.explained;
  // The link itself was refused: that message sits under the field instead.
  if (isLinkProblem(result)) return null;
  const action =
    x.botMayExist ? (result.session ? view(result.session.id, "View the session") : null)
    : x.action === "sign_in" ? <Button variant="secondary" size="sm" onClick={() => void clerk.signOut({ redirectUrl: "/sign-in" })}>Sign in again</Button>
    : x.action === "choose_org" ? <Button asChild variant="secondary" size="sm"><Link to="/choose-organization">Choose an organization</Link></Button>
    : null;
  return (
    <Callout tone={x.tone} title={x.title} action={action} onDismiss={x.botMayExist ? undefined : onDismiss}>
      {x.detail && <p className="m-0">{x.detail}</p>}
      {inOrg}
    </Callout>
  );
}
