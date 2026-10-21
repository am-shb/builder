import { useColorScheme } from "react-native";

// The Boardroom tokens (ADR 0015), the same values as apps/web/src/styles/globals.css, for both color schemes. The
// only file in the app with raw colors: screens and components read them through useTheme().
export type Colors = typeof light;

const light = {
  bg: "#f4f6f5",
  surface: "#ffffff",
  sunk: "#e9eeec",
  plate: "#e6ecea",
  hair: "#dbe2df",
  ink: "#1a2220",
  ink2: "#56605d",
  ink3: "#616b68",
  input: "#7d8784",
  primary: "#0d5c4c",
  primaryPressed: "#0a4b3e",
  onPrimary: "#ffffff",
  live: "#19a67a",
  accentTint: "rgba(13, 92, 76, 0.1)",
  accentInk: "#0a5541",
  infoBg: "#e4ecea",
  infoInk: "#2c4a43",
  warnBg: "#fbefd5",
  warnInk: "#6e4300",
  danger: "#b42318",
  dangerBg: "#fde8e5",
  onDanger: "#ffffff",
  status: {
    live: { bg: "#dcf3ea", ink: "#0a5541" },
    join: { bg: "#e4ecea", ink: "#2c4a43" },
    warn: { bg: "#fbecc9", ink: "#6e4300" },
    fail: { bg: "#fbe3df", ink: "#9d2117" },
    end: { bg: "#e8ebea", ink: "#4f5956" },
  },
};

const dark: Colors = {
  bg: "#0f1513",
  surface: "#1b2421",
  sunk: "#1f2a26",
  plate: "#18211e",
  hair: "#26302c",
  ink: "#eef3f1",
  ink2: "#a3aeaa",
  ink3: "#8f9b97",
  input: "#6f7b77",
  primary: "#4fcfa6",
  primaryPressed: "#6edcb8",
  onPrimary: "#05261c",
  live: "#4fcfa6",
  accentTint: "rgba(79, 207, 166, 0.12)",
  accentInk: "#8bf0cd",
  infoBg: "#1e2a27",
  infoInk: "#c5d6d0",
  warnBg: "#2b2213",
  warnInk: "#f3c06a",
  danger: "#ff8c7f",
  dangerBg: "#3a1a17",
  onDanger: "#1b2421",
  status: {
    live: { bg: "#133a2f", ink: "#8bf0cd" },
    join: { bg: "#1e2a27", ink: "#c5d6d0" },
    warn: { bg: "#352810", ink: "#f6c46d" },
    fail: { bg: "#3a1a17", ink: "#ffa094" },
    end: { bg: "#1f2724", ink: "#a3aeaa" },
  },
};

export const colorsFor = (scheme: "light" | "dark" | null | undefined): Colors => (scheme === "dark" ? dark : light);

export function useTheme(): { colors: Colors; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { colors: colorsFor(scheme), scheme };
}

// Schibsted Grotesk, the web's one family, loaded in app/_layout.tsx. The names are the font package's.
export const font = {
  regular: "SchibstedGrotesk_400Regular",
  medium: "SchibstedGrotesk_500Medium",
  semibold: "SchibstedGrotesk_600SemiBold",
} as const;

// The type scale and spacing, from the web's tokens: body 16 (no iOS zoom), labels 14, the session code set large.
export const type = { title: 30, titleSm: 24, body: 16, label: 14, small: 13 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32 } as const;
export const radius = { pill: 999, field: 12, panel: 16 } as const;
// Touch targets 44 or more; list rows 64 or more (ADR 0015).
export const touch = { min: 44, row: 64 } as const;
