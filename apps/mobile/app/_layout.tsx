import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { PRODUCT_NAME } from "@builder/session-core";
import { SchibstedGrotesk_400Regular, SchibstedGrotesk_500Medium, SchibstedGrotesk_600SemiBold, useFonts } from "@expo-google-fonts/schibsted-grotesk";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { ApiProvider } from "../src/api/ApiProvider.tsx";
import { PageState } from "../src/components/Screen.tsx";
import { envFromProcess, readConfig } from "../src/config.ts";
import { font, useTheme } from "../src/theme.ts";

// The splash stays up until the font is in, so the first screen never flashes a system font.
void SplashScreen.preventAutoHideAsync();

// The app (ADR 0016): Clerk with its secure token cache and no telemetry, one api client, and the routes. With a
// setting missing or malformed, a "not configured" screen instead of a crash. Sign-in and sign-up are Clerk's hosted
// pages (app/(auth)); everything under app/(app) needs an organization.
export default function RootLayout() {
  const config = useMemo(() => readConfig(envFromProcess()), []);
  const [fontsLoaded] = useFonts({ SchibstedGrotesk_400Regular, SchibstedGrotesk_500Medium, SchibstedGrotesk_600SemiBold });
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  if (!config.clerkPublishableKey || !config.apiUrl) {
    return (
      <PageState title={`${PRODUCT_NAME} isn't configured`}>
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY and EXPO_PUBLIC_API_URL (see apps/mobile/.env.example), then start the app again.
      </PageState>
    );
  }
  return (
    <ClerkProvider publishableKey={config.clerkPublishableKey} tokenCache={tokenCache} telemetry={false}>
      <ApiProvider baseUrl={config.apiUrl}>
        <Routes />
      </ApiProvider>
    </ClerkProvider>
  );
}

function Routes() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: font.semibold, color: colors.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="choose-organization" options={{ title: "Choose an organization" }} />
      </Stack>
    </>
  );
}
