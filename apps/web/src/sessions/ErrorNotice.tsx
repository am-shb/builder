import { useClerk } from "@clerk/react";
import { ArrowLeft, RotateCw } from "lucide-react";
import { Link } from "react-router";
import type { ErrorContext } from "@builder/session-core";
import { explainError } from "@builder/session-core";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Callout.tsx";

// An api error in our words, with the one action it calls for (plan: the error table). Persistent, never a toast.
export function ErrorNotice({ error, context, onRefresh, refreshing = false, className }: {
  error: unknown;
  context: ErrorContext;
  // Leave out to show no "Try again" (when the page already has a Refresh button).
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}) {
  const clerk = useClerk();
  const x = explainError(error, context);
  const action =
    x.action === "refresh" && onRefresh ? (
      <Button variant="secondary" size="sm" onClick={onRefresh} busy={refreshing} busyLabel="Trying again…"><RotateCw aria-hidden="true" />Try again</Button>
    ) : x.action === "sign_in" ? (
      // Never automatic: the person chooses to sign in again.
      <Button variant="secondary" size="sm" onClick={() => void clerk.signOut({ redirectUrl: "/sign-in" })}>Sign in again</Button>
    ) : x.action === "choose_org" ? (
      <Button asChild variant="secondary" size="sm"><Link to="/choose-organization">Choose an organization</Link></Button>
    ) : x.action === "back_to_list" ? (
      <Button asChild variant="secondary" size="sm"><Link to="/"><ArrowLeft aria-hidden="true" />Back to sessions</Link></Button>
    ) : undefined;
  return (
    <Callout tone={x.tone} title={x.title} role="alert" action={action} className={className}>
      {x.detail}
    </Callout>
  );
}
