import { Button } from "../components/Button.tsx";
import { AppShell } from "../components/AppShell.tsx";
import { DraftToAgreed } from "../components/Mark.tsx";
import { PageState } from "../components/PageState.tsx";

// Clerk's script didn't load (offline, blocked): nothing can be signed into, so say so and offer a retry.
export function ClerkUnavailablePage() {
  return (
    <AppShell>
      <PageState icon={<DraftToAgreed />} title="Sign-in isn't available right now"
        action={<Button variant="secondary" onClick={() => location.reload()}>Try again</Button>}>
        <p className="m-0">Check your connection, then try again.</p>
      </PageState>
    </AppShell>
  );
}
