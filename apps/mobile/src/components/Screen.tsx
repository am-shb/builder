import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, space, type as typeScale, useTheme } from "../theme.ts";

// A scrolling page body with the app's gutters and the bottom safe area. Lists use their own FlatList instead.
export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: space.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: space.lg + insets.bottom, backgroundColor: colors.bg, borderTopColor: colors.hair }]}>{footer}</View> : null}
    </View>
  );
}

// A full-screen state: loading, not configured, no such session.
export function PageState({ title, children, action, busy = false }: { title: string; children?: ReactNode; action?: ReactNode; busy?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: colors.bg }]}>
      {busy && <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: space.lg }} />}
      <Text accessibilityRole="header" style={[styles.stateTitle, { color: colors.ink }]}>{title}</Text>
      {children ? <Text style={[styles.stateText, { color: colors.ink2 }]}>{children}</Text> : null}
      {action ? <View style={{ marginTop: space.xl }}>{action}</View> : null}
    </View>
  );
}

// The page title and its one-line subtitle.
export function PageIntro({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.intro}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.ink2 }]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: space.xxl },
  body: { padding: space.xl, gap: space.xl },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  intro: { gap: space.sm },
  title: { fontFamily: font.semibold, fontSize: typeScale.title, letterSpacing: -0.8 },
  subtitle: { fontFamily: font.regular, fontSize: typeScale.body, lineHeight: 22 },
  stateTitle: { fontFamily: font.semibold, fontSize: typeScale.titleSm, textAlign: "center", letterSpacing: -0.5 },
  stateText: { fontFamily: font.regular, fontSize: typeScale.body, textAlign: "center", lineHeight: 22, marginTop: space.sm },
});
