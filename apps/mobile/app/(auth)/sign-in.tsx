import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { BOT_NAME, PRODUCT_NAME } from "@builder/session-core";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { makeRedirectUri } from "expo-auth-session";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../src/components/Button.tsx";
import { Callout } from "../../src/components/Callout.tsx";
import { font, radius, space, type as typeScale, useTheme } from "../../src/theme.ts";

type Mode = "sign-in" | "sign-up";

// Sign-in and sign-up through Clerk's hosted pages (ADR 0016): the same instance, methods and organization step as the
// web app, in the system browser, which comes back to the app when done. In Expo Go the app has no scheme of its own,
// so the callback is Expo Go's development URL for this very screen: a signed-in visitor here goes on to the app
// (app/(auth)/_layout.tsx), and a path the router doesn't know would show "Unmatched Route" instead. A built app uses
// the callback Clerk registers for its package, which the @clerk/expo config plugin wires up outside the router.
export default function SignInScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState<Mode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function go(mode: Mode) {
    if (busy) return;
    setBusy(mode);
    setProblem(null);
    const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    try {
      const result = await startHostedAuth({ mode, ...(inExpoGo ? { redirectUrl: makeRedirectUri({ path: "sign-in" }) } : {}) });
      const closed = result.authSessionResult?.type === "cancel" || result.authSessionResult?.type === "dismiss";
      if (!result.createdSessionId && !closed) setProblem("Sign-in didn't finish. Try again.");
    } catch {
      setProblem("Sign-in isn't available right now. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top + space.xxl * 2, paddingBottom: insets.bottom + space.xxl }]}>
      <View style={styles.brand}>
        <View style={[styles.markFrame, { borderColor: colors.primary }]}>
          <View style={[styles.mark, { backgroundColor: colors.primary }]} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{PRODUCT_NAME}</Text>
        <Text style={[styles.subtitle, { color: colors.ink2 }]}>Send {BOT_NAME} into a meeting, then follow each session here.</Text>
      </View>
      <View style={styles.actions}>
        {problem && <Callout tone="error" title={problem} />}
        <Button title="Sign in" block onPress={() => void go("sign-in")} busy={busy === "sign-in"} busyLabel="Opening sign-in…" disabled={busy === "sign-up"} />
        <Button title="Create an account" variant="secondary" block onPress={() => void go("sign-up")} busy={busy === "sign-up"} busyLabel="Opening sign-up…" disabled={busy === "sign-in"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.xl, justifyContent: "space-between" },
  brand: { alignItems: "flex-start", gap: space.lg },
  markFrame: { width: 56, height: 56, borderRadius: radius.field + 4, borderWidth: 2, borderStyle: "dashed", padding: 6 },
  mark: { flex: 1, borderRadius: radius.field - 2 },
  title: { fontFamily: font.semibold, fontSize: 40, letterSpacing: -1.2 },
  subtitle: { fontFamily: font.regular, fontSize: typeScale.body + 1, lineHeight: 24, maxWidth: 360 },
  actions: { gap: space.md },
});
