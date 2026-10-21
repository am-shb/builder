import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { font, radius, space, touch, type as typeScale, useTheme } from "../theme.ts";

// A labelled field with a hint and an error line, as on the web. The error replaces the hint and is read by screen
// readers through the input's accessibility hint. Text is 16, so iOS never zooms into it.
export function TextField({ label, hint, error, containerStyle, ...input }: TextInputProps & {
  label: string;
  hint?: string;
  error?: string | undefined;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const note = error ?? hint;
  return (
    <View style={containerStyle}>
      <Text style={[styles.label, { color: colors.ink2 }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={note}
        placeholderTextColor={colors.input}
        selectionColor={colors.primary}
        {...input}
        style={[
          styles.input,
          { color: colors.ink, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.hair },
          input.editable === false && { opacity: 0.7 },
        ]}
      />
      {note ? <Text accessibilityLiveRegion={error ? "assertive" : "none"} style={[styles.note, { color: error ? colors.danger : colors.ink3 }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: font.semibold, fontSize: typeScale.label, marginBottom: space.sm },
  input: {
    minHeight: touch.min + 4,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.field,
    borderWidth: 1,
    fontFamily: font.regular,
    fontSize: typeScale.body,
  },
  note: { fontFamily: font.regular, fontSize: typeScale.small, marginTop: space.sm, lineHeight: 18 },
});
