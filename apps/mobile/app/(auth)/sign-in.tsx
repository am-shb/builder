import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { BOT_NAME, PRODUCT_NAME } from "@builder/session-core";
import { makeRedirectUri } from "expo-auth-session";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../src/components/Button.tsx";
import { Callout } from "../../src/components/Callout.tsx";
import { font, space, type as typeScale, useTheme } from "../../src/theme.ts";

type Mode = "sign-in" | "sign-up";

// The mark: Builder's robot in each scheme's green, as the web app draws it (apps/web/src/components/Mark.tsx).
// Decorative: the title names it.
const MARK = { light: require("../../assets/images/mark.png"), dark: require("../../assets/images/mark-dark.png") };

// Sign-in and sign-up through Clerk's hosted pages (ADR 0016): the same instance, methods and organization step as the
// web app, in the system browser, which comes back to the app when done. The callback is always this very screen's
// URL (exp://.../--/sign-in in Expo Go, builder://sign-in in a build): a signed-in visitor here goes on to the app
// (app/(auth)/_layout.tsx). Left to its default, Clerk picks a path the router doesn't know, which showed "Unmatched
// Route" on a phone, and in a build it needs the package callback that only a rebuilt native project handles.
export default function SignInScreen() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState<Mode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function go(mode: Mode) {
    if (busy) return;
    setBusy(mode);
    setProblem(null);
    try {
      const result = await startHostedAuth({ mode, redirectUrl: makeRedirectUri({ path: "sign-in" }) });
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
        <Image source={MARK[scheme]} style={styles.mark} accessibilityIgnoresInvertColors />
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
  mark: { width: 64, height: 64, marginLeft: -4 },
  title: { fontFamily: font.semibold, fontSize: 40, letterSpacing: -1.2 },
  subtitle: { fontFamily: font.regular, fontSize: typeScale.body + 1, lineHeight: 24, maxWidth: 360 },
  actions: { gap: space.md },
});
