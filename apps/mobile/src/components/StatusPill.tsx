import { isInProgress, isKnownStatus, statusLabel } from "@builder/session-core";
import { StyleSheet, Text, View } from "react-native";
import { font, radius, space, type as typeScale, useTheme, type Colors } from "../theme.ts";

// Which tint a status takes (ADR 0015): live mint, starting and joining the quiet join tint, an unconfirmed start
// amber, a failure red, everything else (ended, unknown) grey. Never color alone: the word is always there.
function tone(status: string, colors: Colors) {
  if (status === "in_meeting") return colors.status.live;
  if (isInProgress(status)) return colors.status.join;
  if (status === "start_unknown") return colors.status.warn;
  if (status === "start_failed" || status === "failed") return colors.status.fail;
  return colors.status.end;
}

function Dot({ status, ink }: { status: string; ink: string }) {
  const { colors } = useTheme();
  if (status === "in_meeting") return <View style={[styles.dot, { backgroundColor: colors.live }]} />;
  if (isInProgress(status)) return <View style={[styles.ring, { borderColor: ink }]} />;
  if (status === "failed") return <View style={[styles.diamond, { backgroundColor: ink }]} />;
  if (!isKnownStatus(status)) return <Text style={[styles.question, { color: ink, borderColor: ink }]}>?</Text>;
  return <View style={[styles.dot, { backgroundColor: ink }]} />;
}

// A status as a word in a tinted pill.
export function StatusPill({ status, size = "md" }: { status: string; size?: "md" | "sm" }) {
  const { colors } = useTheme();
  const t = tone(status, colors);
  return (
    <View accessibilityLabel={`Status: ${statusLabel(status)}`} style={[styles.pill, size === "sm" && styles.pillSm, { backgroundColor: t.bg }]}>
      <Dot status={status} ink={t.ink} />
      <Text style={[styles.text, size === "sm" && styles.textSm, { color: t.ink }]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: space.sm, alignSelf: "flex-start" },
  pillSm: { height: 28, paddingLeft: 9, paddingRight: 11, gap: 7 },
  text: { fontFamily: font.semibold, fontSize: typeScale.label },
  textSm: { fontSize: typeScale.small },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderStyle: "dashed" },
  diamond: { width: 8, height: 8, borderRadius: 2, transform: [{ rotate: "45deg" }] },
  question: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, fontSize: 10, lineHeight: 12, textAlign: "center", fontFamily: font.semibold, overflow: "hidden" },
});
