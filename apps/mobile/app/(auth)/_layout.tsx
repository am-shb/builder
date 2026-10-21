import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { PageState } from "../../src/components/Screen.tsx";

// Sign-in: someone already signed in (a pending session included: it goes on to choose an organization) goes to the app.
export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  if (!isLoaded) return <PageState title="" busy />;
  if (isSignedIn) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
