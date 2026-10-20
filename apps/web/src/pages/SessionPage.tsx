import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { SignedInShell } from "../auth/SignedInShell.tsx";
import { Button } from "../components/Button.tsx";
import { DraftToAgreed } from "../components/Mark.tsx";
import { PageState } from "../components/PageState.tsx";

// A session's page. Its detail (W6) comes next.
export function SessionPage() {
  return (
    <SignedInShell>
      <PageState icon={<DraftToAgreed />} title="Session details come next"
        action={<Button asChild variant="secondary"><Link to="/"><ArrowLeft aria-hidden="true" />Back to sessions</Link></Button>}>
        <p className="m-0">This page will show the session's status and its stage link.</p>
      </PageState>
    </SignedInShell>
  );
}
