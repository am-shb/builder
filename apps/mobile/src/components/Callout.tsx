import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { font, radius, space, type as typeScale, useTheme } from "../theme.ts";

// A message with a tone (ADR 0015): errors in the danger tint, warnings in amber (the "a bot may be in the meeting"
// warning is always one of these, and persistent), information in the quiet info tint. `actions` holds its buttons.
export function Callout({ tone, title, detail, actions, children }: {
  tone: "error" | "warning" | "info" | "success";
  title: string;
  detail?: string | undefined;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const look = {
    error: { bg: colors.dangerBg, ink: colors.danger },
    warning: { bg: colors.warnBg, ink: colors.warnInk },
    info: { bg: colors.infoBg, ink: colors.infoInk },
    success: { bg: colors.status.live.bg, ink: colors.status.live.ink },
  }[tone];
  return (
    <View accessibilityRole={tone === "error" || tone === "warning" ? "alert" : "none"} style={[styles.box, { backgroundColor: look.bg }]}>
      <Text style={[styles.title, { color: look.ink }]}>{title}</Text>
      {detail ? <Text style={[styles.detail, { color: look.ink }]}>{detail}</Text> : null}
      {children}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.panel, padding: space.lg, gap: space.sm },
  title: { fontFamily: font.semibold, fontSize: typeScale.body, lineHeight: 22 },
  detail: { fontFamily: font.regular, fontSize: typeScale.label, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
});
