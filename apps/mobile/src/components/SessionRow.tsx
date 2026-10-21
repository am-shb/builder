import { isInProgress, meetingDisplay, startedWhen, type SessionView } from "@builder/session-core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { font, space, touch, type as typeScale, useTheme } from "../theme.ts";
import { StatusPill } from "./StatusPill.tsx";

// One tappable row per session (ADR 0015): the meeting code first and largest, then the status pill, then the platform
// and when it started. Ended and failed codes fade; codes still on their way get a dashed underline.
export function SessionRow({ session, onPress, now }: { session: SessionView; onPress: () => void; now?: Date }) {
  const { colors } = useTheme();
  const meeting = meetingDisplay(session.meetingUrl);
  const faded = session.status === "ended" || session.status === "failed" || session.status === "start_failed";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meeting.code}, ${meeting.platformLabel}, started ${startedWhen(session.createdAt, now)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.hair, backgroundColor: pressed ? colors.plate : "transparent" }]}
    >
      <View style={styles.main}>
        <Text
          numberOfLines={1}
          style={[
            styles.code,
            { color: faded ? colors.ink3 : colors.ink },
            isInProgress(session.status) && { textDecorationLine: "underline", textDecorationStyle: "dashed", textDecorationColor: colors.primary },
          ]}
        >
          {meeting.code}
        </Text>
        <View style={styles.meta}>
          <StatusPill status={session.status} size="sm" />
          <Text numberOfLines={1} style={[styles.when, { color: colors.ink2 }]}>{meeting.platformLabel}, {startedWhen(session.createdAt, now)}</Text>
        </View>
      </View>
      <Text style={[styles.chevron, { color: colors.ink3 }]} accessibilityElementsHidden>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touch.row, paddingVertical: space.lg, paddingHorizontal: space.xl, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, gap: space.sm },
  code: { fontFamily: font.semibold, fontSize: typeScale.titleSm, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  meta: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" },
  when: { fontFamily: font.regular, fontSize: typeScale.label, flexShrink: 1 },
  chevron: { fontSize: 28, fontFamily: font.regular, marginLeft: space.md },
});
