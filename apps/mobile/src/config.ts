import { apiOrigin, clerkFrontendApiHost } from "@builder/session-core";

// The mobile app's two settings (ADR 0016), both public by design and built into the JavaScript. A missing or malformed
// one turns the app into a "not configured" screen instead of failing the build. The rules are the web app's
// (session-core/settings.ts), so both apps accept the same values.
export type MobileConfig = { clerkPublishableKey: string | null; apiUrl: string | null };

export type ConfigEnv = { clerkPublishableKey?: string | undefined; apiUrl?: string | undefined; production?: boolean };

// Expo inlines a public setting only where its whole name is written out after process.env, so the two reads are literal.
export function envFromProcess(): ConfigEnv {
  return {
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    production: !__DEV__,
  };
}

export function readConfig(env: ConfigEnv): MobileConfig {
  const key = (env.clerkPublishableKey ?? "").trim();
  return {
    clerkPublishableKey: clerkFrontendApiHost(key) ? key : null,
    apiUrl: apiOrigin(env.apiUrl ?? "", { production: env.production === true }),
  };
}
