import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { PageState } from "../../src/components/Screen.tsx";
import { StartSessionProvider } from "../../src/sessions/StartSessionProvider.tsx";
import { font, useTheme } from "../../src/theme.ts";

// Screens for members of an organization, as the web's RequireOrg guard: no session goes to sign-in; a session with
// no active organization (a new account's pending "choose-organization" step, or after leaving the last org) goes to
// choose one. The org always comes from the session token; the app never sends an org id.
export default function AppLayout() {
  const { isLoaded, isSignedIn, orgId } = useAuth({ treatPendingAsSignedOut: false });
  const { colors } = useTheme();
  if (!isLoaded) return <PageState title="" busy />;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (!orgId) return <Redirect href="/choose-organization" />;
  return (
    <StartSessionProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: font.semibold, color: colors.ink },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Sessions" }} />
        <Stack.Screen name="new" options={{ title: "New session", presentation: "modal" }} />
        <Stack.Screen name="sessions/[id]" options={{ title: "Session" }} />
      </Stack>
    </StartSessionProvider>
  );
}
