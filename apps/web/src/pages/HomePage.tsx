import { BOT_NAME } from "../brand.ts";
import { SignedInShell } from "../auth/SignedInShell.tsx";
import { PageIntro, SplitLayout } from "../components/AppShell.tsx";
import { SessionsList } from "../sessions/SessionsList.tsx";

// The sessions page: the org's sessions (W4). Starting one from here comes in W5.
export function HomePage() {
  return (
    <SignedInShell>
      <SplitLayout intro={<PageIntro title="Sessions" subtitle={`Send ${BOT_NAME} into a meeting, then follow each session here.`} />}>
        <SessionsList />
      </SplitLayout>
    </SignedInShell>
  );
}
