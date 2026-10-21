import { BOT_NAME, statusLabel, type StartResult } from "@builder/session-core";
import { useRouter } from "expo-router";
import { Button } from "../components/Button.tsx";
import { Callout } from "../components/Callout.tsx";

// What a start came to, above the list until the next start or until put away (the web's StartOutcome). A start that
// may have sent a bot is a persistent warning with no retry; a link problem never shows here (it's under the field).
export function StartOutcome({ result, currentOrgId, onDismiss }: { result: StartResult; currentOrgId: string | null | undefined; onDismiss: () => void }) {
  const router = useRouter();
  const elsewhere = result.org.id && currentOrgId && result.org.id !== currentOrgId ? ` Started in ${result.org.name ?? "another organization"}.` : "";
  const view = result.kind === "failed" ? result.session : result.session;
  const actions = (
    <>
      {view && <Button title="View session" variant="secondary" onPress={() => router.push({ pathname: "/sessions/[id]", params: { id: view.id } })} />}
      <Button title="Dismiss" variant="quiet" onPress={onDismiss} />
    </>
  );
  if (result.kind === "started") {
    return <Callout tone="success" title={`${BOT_NAME} is joining the meeting.`} detail={`Admit it when it asks to join.${elsewhere}`} actions={actions} />;
  }
  if (result.kind === "reused") {
    return (
      <Callout tone="info" title={`This meeting already has a ${BOT_NAME} session.`}
        detail={`Status: ${statusLabel(result.session.status)}. No second bot was sent.${elsewhere}`} actions={actions} />
    );
  }
  const detail = [result.explained.detail, elsewhere.trim()].filter(Boolean).join(" ");
  return <Callout tone={result.explained.tone} title={result.explained.title} detail={detail || undefined} actions={actions} />;
}
