import { RotateCw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { AppShell } from "./AppShell.tsx";
import { Button } from "./Button.tsx";
import { DraftToAgreed } from "./Mark.tsx";
import { PageState } from "./PageState.tsx";

// If a page throws while rendering, show a way out instead of a blank page. It sits above the router and Clerk, so it
// uses a plain link home and a full reload. The error itself isn't logged here: it may hold data from the page.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <AppShell>
        <PageState icon={<DraftToAgreed />} title="Something went wrong"
          action={<Button variant="secondary" onClick={() => window.location.reload()}><RotateCw aria-hidden="true" />Reload</Button>}>
          <p className="m-0">This page stopped working. Reload it to try again. Sessions already started keep running.</p>
        </PageState>
      </AppShell>
    );
  }
}
