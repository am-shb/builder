import { BOT_NAME, checkMeetingLink, isLinkProblem, linkProblemText, startConfirmation, statusLabel } from "@builder/session-core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { useOrgQuery } from "../../src/api/ApiProvider.tsx";
import { Button } from "../../src/components/Button.tsx";
import { Screen } from "../../src/components/Screen.tsx";
import { TextField } from "../../src/components/TextField.tsx";
import { useStartSession } from "../../src/sessions/StartSessionProvider.tsx";
import { font, space, type as typeScale, useTheme } from "../../src/theme.ts";

export const LINK_HINT = `Google Meet, Zoom or Teams. ${BOT_NAME} asks to join; admit it from the meeting.`;
export const LINK_ERROR = "Use an https Google Meet, Zoom or Teams link.";

// The start form (the web's StartForm and the HomePage's guards): one field and one button. A link that isn't an https
// URL sends nothing. Before sending, the same two questions as the web: an earlier start for this meeting that didn't
// confirm (WD8), or a session for the same meeting under another copy of the link. The button is busy while the
// request runs, so a double tap sends one request; the field keeps the link until the reply says it's fine.
export default function NewSessionScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const starter = useStartSession();
  const list = useOrgQuery((api, signal) => api.listSessions(signal));
  const [invalid, setInvalid] = useState(false);
  const [slow, setSlow] = useState(false);
  const linkError = linkProblemText(starter.result);

  useEffect(() => {
    if (!starter.sending) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [starter.sending]);

  async function send(url: string) {
    const result = await starter.start(url);
    // A link problem keeps the form open to fix it; anything else closes it, and the list shows the outcome.
    if (result && !isLinkProblem(result)) router.back();
  }

  function submit() {
    if (starter.sending) return;
    const url = checkMeetingLink(starter.draft);
    if (!url) return setInvalid(true);
    const why = startConfirmation(starter.result, list.data ?? [], url);
    if (!why) return void send(url);
    Alert.alert(
      "Start another session for this link?",
      why.kind === "active"
        ? `This meeting already has a ${BOT_NAME} session (${statusLabel(why.session.status)}), started from another copy of the link. Starting again sends a second ${BOT_NAME} bot.`
        : `An earlier start for this link didn't confirm. Check the meeting for a ${BOT_NAME} bot before starting another.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Start anyway", style: "destructive", onPress: () => void send(url) },
      ],
    );
  }

  return (
    <Screen>
      <TextField
        label="Meeting link"
        hint={LINK_HINT}
        error={invalid ? LINK_ERROR : linkError}
        placeholder="Paste a meeting link"
        value={starter.draft}
        onChangeText={(value) => {
          starter.setDraft(value);
          setInvalid(false);
          // Editing the link puts away the reply about it.
          if (linkError) starter.dismiss();
        }}
        editable={!starter.sending}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        textContentType="URL"
        returnKeyType="go"
        onSubmitEditing={submit}
        autoFocus
      />
      <Button title="Start session" block onPress={submit} busy={starter.sending} busyLabel="Starting…" />
      <Text accessibilityLiveRegion="polite" style={[styles.slow, { color: colors.ink2 }]}>
        {slow ? "This can take up to 20 seconds. Keep this screen open." : ""}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slow: { fontFamily: font.regular, fontSize: typeScale.label, textAlign: "center", marginTop: -space.sm },
});
