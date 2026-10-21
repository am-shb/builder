import { useClerk } from "@clerk/expo";
import { explainError, type ErrorContext } from "@builder/session-core";
import { useRouter } from "expo-router";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Callout.tsx";

// An api error in our own words, with the action the error table offers (session-core/errors.ts): Refresh, Sign in
// again (never automatic), choose an organization, back to the list, or none.
export function ErrorNotice({ error, context, onRefresh, refreshing = false }: {
  error: unknown;
  context: ErrorContext;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const x = explainError(error, context);
  const router = useRouter();
  const { signOut } = useClerk();
  const action = (() => {
    switch (x.action) {
      case "refresh":
        return onRefresh ? <Button title="Refresh" variant="secondary" onPress={onRefresh} busy={refreshing} busyLabel="Refreshing…" /> : null;
      case "sign_in":
        // Signing out clears the stale session; the sign-in screen follows from the guard.
        return <Button title="Sign in again" variant="secondary" onPress={() => void signOut()} />;
      case "choose_org":
        return <Button title="Choose an organization" variant="secondary" onPress={() => router.push("/choose-organization")} />;
      case "back_to_list":
        return <Button title="Back to sessions" variant="secondary" onPress={() => router.replace("/")} />;
      default:
        return null;
    }
  })();
  return <Callout tone={x.tone} title={x.title} detail={x.detail} actions={action} />;
}
