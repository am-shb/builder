import { AppShell } from "../components/AppShell.tsx";
import { DraftToAgreed } from "../components/Mark.tsx";
import { PageState } from "../components/PageState.tsx";
import { usePageTitle } from "../hooks/usePageTitle.ts";

// The build has no usable sign-in settings (ADR 0012): say so instead of loading anything.
export function NotConfiguredPage() {
  usePageTitle("Not set up yet");
  return (
    <AppShell>
      <PageState icon={<DraftToAgreed />} title="Not set up yet">
        <p className="m-0">
          This build has no sign-in settings. Set <code className="text-ink">VITE_CLERK_PUBLISHABLE_KEY</code> and{" "}
          <code className="text-ink">VITE_API_URL</code>, then build again.
        </p>
      </PageState>
    </AppShell>
  );
}
