import { useAuth, useClerk, useOrganization } from "@clerk/expo";
import { BOT_NAME, isLinkProblem, mayStillChange, roleLabel, type SessionView } from "@builder/session-core";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrgQuery } from "../../src/api/ApiProvider.tsx";
import { Button } from "../../src/components/Button.tsx";
import { PageIntro } from "../../src/components/Screen.tsx";
import { SessionRow } from "../../src/components/SessionRow.tsx";
import { useAutoRefresh } from "../../src/hooks/useAutoRefresh.ts";
import { ErrorNotice } from "../../src/sessions/ErrorNotice.tsx";
import { StartOutcome } from "../../src/sessions/StartOutcome.tsx";
import { useStartSession } from "../../src/sessions/StartSessionProvider.tsx";
import { font, radius, space, touch, type as typeScale, useTheme } from "../../src/theme.ts";

// The sessions screen (the web's HomePage): the org's sessions, newest first, a start's outcome above them, and New
// session in a bar at the bottom. Pull down to refresh; while a session may still change, the list refreshes itself
// quietly every 10 seconds.
export default function SessionsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { orgId } = useAuth();
  const list = useOrgQuery((api, signal) => api.listSessions(signal));
  useAutoRefresh((list.data ?? []).some((s) => mayStillChange(s)), list.quietRefresh);
  const starter = useStartSession();

  // The list reloads after every start, so a new or saved session shows up.
  const { refresh } = list;
  const settledSeen = useRef(starter.settled);
  useEffect(() => {
    if (starter.settled === settledSeen.current) return;
    settledSeen.current = starter.settled;
    refresh();
  }, [starter.settled, refresh]);

  const open = useCallback((s: SessionView) => router.push({ pathname: "/sessions/[id]", params: { id: s.id } }), [router]);
  const result = starter.result && !isLinkProblem(starter.result) ? starter.result : null;
  const sessions = list.data ?? [];
  const empty = list.status === "ready" && sessions.length === 0;

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ headerRight: () => <HeaderButtons /> }} />
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SessionRow session={item} onPress={() => open(item)} />}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={colors.primary} colors={[colors.primary]} />}
        contentContainerStyle={{ paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageIntro title="Sessions" subtitle={`Send ${BOT_NAME} into a meeting, then follow each session here.`} />
            {result && <StartOutcome result={result} currentOrgId={orgId} onDismiss={starter.dismiss} />}
            {list.status === "error" && !list.refreshing && (
              <ErrorNotice error={list.error} context="read" onRefresh={list.refresh} refreshing={list.refreshing} />
            )}
            {sessions.length > 0 && <Text style={[styles.recent, { color: colors.ink2 }]}>Recent</Text>}
          </View>
        }
        ListEmptyComponent={
          list.status === "loading"
            ? <ActivityIndicator accessibilityLabel="Loading sessions" color={colors.primary} style={{ marginTop: space.xxl }} />
            : empty
              ? <EmptyState onStart={() => router.push("/new")} />
              : undefined
        }
      />
      {!empty && (
        <View style={[styles.bar, { paddingBottom: space.lg + insets.bottom, backgroundColor: colors.bg, borderTopColor: colors.hair }]}>
          <Button title="New session" block onPress={() => router.push("/new")} />
        </View>
      )}
    </View>
  );
}

// The empty state: the three real steps and the one button (ADR 0015).
function EmptyState({ onStart }: { onStart: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>Start your first session</Text>
      {[`Paste a Google Meet, Zoom or Teams link.`, `${BOT_NAME} asks to join; admit it from the meeting.`, `Follow the session here while ${BOT_NAME} builds.`].map((step, i) => (
        <Text key={step} style={[styles.step, { color: colors.ink2 }]}>{i + 1}. {step}</Text>
      ))}
      <Button title="New session" onPress={onStart} style={{ marginTop: space.lg }} />
    </View>
  );
}

// The top bar's right side: the organization (tap to switch) and the account (tap to sign out).
function HeaderButtons() {
  const { colors } = useTheme();
  const router = useRouter();
  const { organization, membership } = useOrganization();
  const { signOut } = useClerk();
  const confirmSignOut = () =>
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  return (
    <View style={styles.headerRight}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${organization?.name ?? "Organization"}, switch organization`}
        onPress={() => router.push("/choose-organization")}
        style={({ pressed }) => [styles.orgButton, { backgroundColor: pressed ? colors.plate : colors.accentTint }]}
      >
        <Text numberOfLines={1} style={[styles.orgName, { color: colors.accentInk }]}>{organization?.name ?? "Organization"}</Text>
        {membership?.role && <Text style={[styles.role, { color: colors.ink2 }]}>{roleLabel(membership.role)}</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Account, sign out" onPress={confirmSignOut} hitSlop={8}
        style={({ pressed }) => [styles.accountButton, { backgroundColor: pressed ? colors.plate : colors.sunk }]}>
        <Text style={[styles.accountGlyph, { color: colors.ink2 }]}>⋯</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { padding: space.xl, gap: space.xl },
  recent: { fontFamily: font.semibold, fontSize: typeScale.label, marginBottom: -space.md },
  bar: { paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  empty: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.sm, alignItems: "flex-start" },
  emptyTitle: { fontFamily: font.semibold, fontSize: typeScale.titleSm, letterSpacing: -0.5, marginBottom: space.xs },
  step: { fontFamily: font.regular, fontSize: typeScale.body, lineHeight: 22 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space.sm, maxWidth: 240 },
  orgButton: { flexDirection: "row", alignItems: "baseline", gap: space.sm, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, flexShrink: 1 },
  orgName: { fontFamily: font.semibold, fontSize: typeScale.label, flexShrink: 1 },
  role: { fontFamily: font.regular, fontSize: typeScale.small },
  accountButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", minWidth: touch.min - 8 },
  accountGlyph: { fontSize: 20, lineHeight: 22, fontFamily: font.semibold },
});
