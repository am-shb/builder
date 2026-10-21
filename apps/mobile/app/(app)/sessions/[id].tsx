import { useAuth } from "@clerk/expo";
import { ApiError, BOT_NAME, exactTime, limitsText, mayStillChange, meetingDisplay, safeStageUrl, startedWhen, statusExplanation, type SessionView } from "@builder/session-core";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useOrgQuery, type OrgQuery } from "../../../src/api/ApiProvider.tsx";
import { Button } from "../../../src/components/Button.tsx";
import { Callout } from "../../../src/components/Callout.tsx";
import { PageState, Screen } from "../../../src/components/Screen.tsx";
import { StatusPill } from "../../../src/components/StatusPill.tsx";
import { useAutoRefresh } from "../../../src/hooks/useAutoRefresh.ts";
import { ErrorNotice } from "../../../src/sessions/ErrorNotice.tsx";
import { font, radius, space, type as typeScale, useTheme } from "../../../src/theme.ts";

// A session's screen (the web's SessionPage): its status and what it means, the meeting, its times and limits, an
// error code for support, and the stage link behind "Show". From GET /v1/sessions/:id, for the active org only. While
// the session may still change the screen refreshes itself every 10 seconds.
export default function SessionScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useOrgQuery((api, signal) => api.getSession(id, signal), id);
  const session = query.data;
  useAutoRefresh(session !== undefined && mayStillChange(session), query.quietRefresh);
  const notFound = query.status === "error" && query.error instanceof ApiError && query.error.code === "not_found";
  useLeaveOnOrgSwitch(session ? "session" : notFound ? "not_found" : undefined);
  const title = session ? meetingDisplay(session.meetingUrl).code : "Session";

  if (notFound) {
    return (
      <>
        <Stack.Screen options={{ title: "Session" }} />
        <PageState title="No such session in this organization" action={<Button title="Back to sessions" variant="secondary" onPress={() => router.replace("/")} />}>
          It may be in another organization. Switch organization to look there.
        </PageState>
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title, headerRight: () => <RefreshButton query={query} /> }} />
      <Screen>
        {query.status === "error" && !session && <ErrorNotice error={query.error} context="detail" onRefresh={query.refresh} refreshing={query.refreshing} />}
        {session ? <Loaded session={session} query={query} /> : query.status === "loading" ? <ActivityIndicator accessibilityLabel="Loading the session" style={{ marginTop: space.xxl }} /> : null}
      </Screen>
    </>
  );
}

function RefreshButton({ query }: { query: OrgQuery<SessionView> }) {
  return <Button title="Refresh" variant="quiet" onPress={query.refresh} busy={query.refreshing} busyLabel="Refreshing…" />;
}

// A session belongs to the org it was started in. Switching org while one is on screen goes back to the list. On "No
// such session", the screen stays and looks again in the new org, as its message suggests.
function useLeaveOnOrgSwitch(showing: "session" | "not_found" | undefined) {
  const { orgId } = useAuth();
  const router = useRouter();
  const previousOrg = useRef(orgId);
  const shown = useRef(showing);
  useEffect(() => {
    if (previousOrg.current !== orgId) {
      previousOrg.current = orgId;
      if (shown.current === "session") router.replace("/");
      shown.current = undefined;
      return;
    }
    shown.current = showing;
  }, [orgId, showing, router]);
}

function Loaded({ session, query }: { session: SessionView; query: OrgQuery<SessionView> }) {
  const { colors } = useTheme();
  const meeting = meetingDisplay(session.meetingUrl);
  const explanation = statusExplanation(session.status, session.errorCode);
  const limits = limitsText(session.limits);
  return (
    <>
      <View style={styles.titleBlock}>
        <Text style={[styles.subtitle, { color: colors.ink2 }]}>{meeting.platformLabel}, started {startedWhen(session.createdAt)}</Text>
      </View>
      {query.status === "error" && !query.refreshing && (
        <Callout tone="error" title="Couldn't refresh the details." detail={query.loadedAt ? `Showing the details from ${exactTime(query.loadedAt.toISOString())}.` : undefined} />
      )}
      <View style={styles.statusRow}>
        <StatusPill status={session.status} />
        {explanation ? <Text style={[styles.explanation, { color: colors.ink }]}>{explanation}</Text> : null}
      </View>
      <View>
        <Text style={[styles.sectionTitle, { color: colors.ink2 }]}>Details</Text>
        <Detail term="Meeting link">{session.meetingUrl}</Detail>
        <Detail term="Started">{exactTime(session.createdAt)}</Detail>
        <Detail term="Last updated">{exactTime(session.updatedAt)}</Detail>
        <Detail term="Spending limit">{limits.spend}</Detail>
        <Detail term="Time limit">{limits.time}</Detail>
        {session.errorCode && (
          <Detail term={session.status === "ended" ? "Reason code (for support)" : "Error code (for support)"}>
            <Text style={[styles.code, { backgroundColor: colors.sunk, color: colors.ink }]}>{session.errorCode}</Text>
          </Detail>
        )}
      </View>
      <StageLink stageUrl={session.stageUrl} />
    </>
  );
}

// One fact: the term above its value. The meeting link is text, never a link of ours.
function Detail({ term, children }: { term: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.detail, { borderTopColor: colors.hair }]}>
      <Text style={[styles.term, { color: colors.ink2 }]}>{term}</Text>
      {typeof children === "string" ? <Text selectable style={[styles.value, { color: colors.ink }]}>{children}</Text> : children}
    </View>
  );
}

// The stage link (the web's WD5): behind "Show", with the warning, Copy and Open; only an https link (http on a
// development build, for a local engine). Never logged, never stored anywhere but the clipboard when asked.
function StageLink({ stageUrl }: { stageUrl: string | undefined }) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = safeStageUrl(stageUrl, { dev: __DEV__ });
  if (!url) return null;
  return (
    <View style={[styles.stage, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.ink2, marginBottom: 0 }]}>Stage link</Text>
      {shown ? (
        <>
          <Text style={[styles.warning, { color: colors.ink }]}>
            This link controls the stage shown in the meeting. Anyone with it can change what's on screen and interrupt {BOT_NAME}'s voice. Don't share it, and don't open it while the meeting is running unless you mean to.
          </Text>
          <View style={styles.stageActions}>
            <Button title={copied ? "Copied" : "Copy"} variant="secondary" onPress={() => { void Clipboard.setStringAsync(url); setCopied(true); }} />
            <Button title="Open" variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(url)} />
          </View>
        </>
      ) : (
        <Button title="Show stage link" variant="secondary" onPress={() => setShown(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: space.xs },
  subtitle: { fontFamily: font.regular, fontSize: typeScale.body },
  statusRow: { gap: space.md },
  explanation: { fontFamily: font.regular, fontSize: typeScale.body, lineHeight: 22 },
  sectionTitle: { fontFamily: font.semibold, fontSize: typeScale.label, marginBottom: space.xs },
  detail: { paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, gap: space.xs },
  term: { fontFamily: font.semibold, fontSize: typeScale.label },
  value: { fontFamily: font.regular, fontSize: typeScale.body, lineHeight: 22 },
  code: { fontFamily: "monospace", fontSize: typeScale.label, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", overflow: "hidden" },
  stage: { borderRadius: radius.panel, padding: space.lg, gap: space.md },
  warning: { fontFamily: font.regular, fontSize: typeScale.label, lineHeight: 20 },
  stageActions: { flexDirection: "row", gap: space.sm },
});
