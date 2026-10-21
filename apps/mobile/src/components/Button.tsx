import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { font, radius, space, touch, type as typeScale, useTheme } from "../theme.ts";

type Variant = "primary" | "secondary" | "quiet" | "danger";

// A pill button, as on the web: one primary per screen, secondary for the rest, quiet for in-line actions. `busy`
// shows a spinner and the busy label and takes no presses, so a double tap sends one request.
export function Button({ title, onPress, variant = "primary", busy = false, busyLabel, disabled = false, block = false, style }: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const inactive = busy || disabled;
  const look = {
    primary: { bg: colors.primary, pressed: colors.primaryPressed, ink: colors.onPrimary, border: "transparent" },
    secondary: { bg: colors.accentTint, pressed: colors.plate, ink: colors.accentInk, border: "transparent" },
    quiet: { bg: "transparent", pressed: colors.plate, ink: colors.ink2, border: "transparent" },
    danger: { bg: colors.dangerBg, pressed: colors.dangerBg, ink: colors.danger, border: "transparent" },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        block && styles.block,
        { backgroundColor: pressed && !inactive ? look.pressed : look.bg, borderColor: look.border, opacity: disabled && !busy ? 0.5 : 1 },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={look.ink} style={styles.spinner} />}
      <Text style={[styles.label, { color: look.ink }]}>{busy && busyLabel ? busyLabel : title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min + 4,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  block: { alignSelf: "stretch" },
  spinner: { marginRight: space.sm },
  label: { fontFamily: font.semibold, fontSize: typeScale.body },
});
