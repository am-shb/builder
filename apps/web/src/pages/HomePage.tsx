import { BOT_NAME } from "../brand.ts";
import { SignedInShell } from "../auth/SignedInShell.tsx";
import { PageIntro, SplitLayout } from "../components/AppShell.tsx";
import { EmptyState } from "../components/EmptyState.tsx";

// The sessions page. The list (W4) and the start form (W5) come next; until then it shows the empty state. It calls
// nothing.
export function HomePage() {
  return (
    <SignedInShell>
      <SplitLayout intro={<PageIntro title="Sessions" subtitle={`Send ${BOT_NAME} into a meeting, then follow each session here.`} />}>
        <h2 className="sr-only">Your sessions</h2>
        <EmptyState
          className="md:mt-[var(--section-baseline,14px)]"
          title="Start your first session"
          description={`Bring ${BOT_NAME} into a meeting. It listens while you decide, and builds the prototype on the shared screen.`}
          steps={["Paste the meeting link", `Admit ${BOT_NAME} when it asks to join`, "Watch the prototype take shape"]}
        />
      </SplitLayout>
    </SignedInShell>
  );
}
