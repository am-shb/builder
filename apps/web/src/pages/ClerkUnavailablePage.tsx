import { Button } from "../components/Button.tsx";
import { AppShell } from "../components/AppShell.tsx";
import { Mark } from "../components/Mark.tsx";
import { PageState } from "../components/PageState.tsx";
import { usePageTitle } from "../hooks/usePageTitle.ts";

// Clerk's script didn't load (offline, blocked): nothing can be signed into, so say so and offer a retry.
export function ClerkUnavailablePage() {
  usePageTitle("Sign-in isn't available");
  return (
    <AppShell>
      <PageState icon={<Mark className="size-16" />} title="Sign-in isn't available right now"
        action={<Button variant="secondary" onClick={() => location.reload()}>Try again</Button>}>
        <p className="m-0">Check your connection, then try again.</p>
      </PageState>
    </AppShell>
  );
}
