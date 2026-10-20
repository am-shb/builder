import { AppShell } from "./components/AppShell.tsx";
import { DraftToAgreed } from "./components/Mark.tsx";
import { PageState } from "./components/PageState.tsx";
import { PRODUCT_NAME } from "./brand.ts";

// A placeholder in the real shell until sign-in lands (W2). It calls nothing.
export function App() {
  return (
    <AppShell>
      <PageState icon={<DraftToAgreed />} title="Sign-in is coming soon">
        <p className="m-0">This is where your {PRODUCT_NAME} sessions will be.</p>
      </PageState>
    </AppShell>
  );
}
