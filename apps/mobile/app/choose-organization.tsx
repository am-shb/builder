import { useAuth, useClerk, useOrganizationList } from "@clerk/expo";
import { roleLabel } from "@builder/session-core";
import { Redirect, Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../src/components/Button.tsx";
import { Callout } from "../src/components/Callout.tsx";
import { PageIntro, PageState, Screen } from "../src/components/Screen.tsx";
import { TextField } from "../src/components/TextField.tsx";
import { font, radius, space, touch, type as typeScale, useTheme } from "../src/theme.ts";

// Every session belongs to an organization (ADR 0006), so a new account creates or joins one before the app opens, and
// a member can switch here later (the web uses Clerk's components for this; there are none on native, so this screen is
// Clerk's organization list and create call, ADR 0016). Choosing one makes it the active org: the next token carries
// it, and every request after it is for that org. Personal accounts aren't offered.
export default function ChooseOrganizationScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { isLoaded, isSignedIn, orgId } = useAuth({ treatPendingAsSignedOut: false });
  const { signOut } = useClerk();
  const orgs = useOrganizationList({ userMemberships: { infinite: true, pageSize: 20 } });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!isLoaded) return <PageState title="" busy />;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  async function choose(organizationId: string) {
    if (!orgs.isLoaded || busy) return;
    setBusy(organizationId);
    setProblem(null);
    try {
      await orgs.setActive({ organization: organizationId });
      router.replace("/");
    } catch {
      setProblem("Couldn't switch to that organization. Try again.");
      setBusy(null);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!orgs.isLoaded || busy || !trimmed) return;
    setBusy("create");
    setProblem(null);
    try {
      const org = await orgs.createOrganization({ name: trimmed });
      await orgs.setActive({ organization: org.id });
      router.replace("/");
    } catch {
      setProblem("Couldn't create the organization. Check the name and try again.");
      setBusy(null);
    }
  }

  const memberships = orgs.isLoaded ? orgs.userMemberships.data ?? [] : [];
  return (
    <>
      <Stack.Screen options={{ headerBackVisible: !!orgId }} />
      <Screen>
        <PageIntro title={orgId ? "Switch organization" : "Choose an organization"} subtitle="Sessions belong to an organization. Pick your company's, or create it." />
        {problem && <Callout tone="error" title={problem} />}
        {!orgs.isLoaded || orgs.userMemberships.isLoading ? (
          <ActivityIndicator accessibilityLabel="Loading organizations" color={colors.primary} />
        ) : memberships.length > 0 ? (
          <View style={[styles.list, { backgroundColor: colors.surface }]}>
            {memberships.map((m) => {
              const current = m.organization.id === orgId;
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current, busy: busy === m.organization.id }}
                  onPress={() => void choose(m.organization.id)}
                  style={({ pressed }) => [styles.row, { borderBottomColor: colors.hair, backgroundColor: pressed ? colors.plate : "transparent" }]}
                >
                  <View style={styles.rowMain}>
                    <Text style={[styles.orgName, { color: colors.ink }]}>{m.organization.name}</Text>
                    <Text style={[styles.role, { color: colors.ink2 }]}>{roleLabel(m.role)}{current ? ", current" : ""}</Text>
                  </View>
                  {busy === m.organization.id ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.chevron, { color: colors.ink3 }]}>›</Text>}
                </Pressable>
              );
            })}
            {orgs.userMemberships.hasNextPage && (
              <Button title="Show more" variant="quiet" onPress={() => orgs.userMemberships.fetchNext()} style={{ margin: space.sm }} />
            )}
          </View>
        ) : null}
        <View style={styles.create}>
          <Text style={[styles.sectionTitle, { color: colors.ink2 }]}>{memberships.length > 0 ? "Or create a new one" : "Create your organization"}</Text>
          <TextField label="Organization name" placeholder="Acme Inc." value={name} onChangeText={setName} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => void create()} editable={busy === null} />
          <Button title="Create organization" block onPress={() => void create()} busy={busy === "create"} busyLabel="Creating…" disabled={!name.trim() || (busy !== null && busy !== "create")} />
        </View>
        {!orgId && <Button title="Sign out" variant="quiet" onPress={() => void signOut()} />}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.panel, overflow: "hidden" },
  row: { minHeight: touch.row, paddingHorizontal: space.lg, paddingVertical: space.md, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, gap: 2 },
  orgName: { fontFamily: font.semibold, fontSize: typeScale.body },
  role: { fontFamily: font.regular, fontSize: typeScale.small },
  chevron: { fontSize: 28, fontFamily: font.regular },
  create: { gap: space.md },
  sectionTitle: { fontFamily: font.semibold, fontSize: typeScale.label },
});
