import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/react";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

// Clerk's sign-in, sign-up, org switcher and user menu follow our tokens (ADR 0013), so they match in light and dark
// without a Clerk theme package. Their styles go in the `clerk` CSS layer, which globals.css orders before Tailwind's
// utilities. Used by ClerkProvider from W2 on.
export const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--on-primary)",
    colorBackground: "var(--surface)",
    colorForeground: "var(--ink)",
    colorMuted: "var(--sunk)",
    colorMutedForeground: "var(--ink-2)",
    colorNeutral: "var(--ink)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--hair)",
    colorRing: "var(--primary)",
    colorDanger: "var(--danger)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warn-ink)",
    colorModalBackdrop: "var(--scrim)",
    fontFamily: "var(--font-sans)",
    fontFamilyButtons: "var(--font-sans)",
    borderRadius: "var(--radius-field)",
  },
} satisfies Appearance;
