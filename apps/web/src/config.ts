import { apiOrigin, clerkFrontendApiHost } from "./lib/settings.ts";

// The web app's two settings (ADR 0012), both public by design and built into the JavaScript. A missing or malformed
// one turns the app into a "not configured" page instead of failing the build. The rules are the same ones the build's
// Content Security Policy uses (src/lib/settings.ts), so an accepted value is never one the policy blocks.
export type WebConfig = { clerkPublishableKey: string | null; apiUrl: string | null };

export function readConfig(env: Record<string, string | boolean | undefined> = import.meta.env): WebConfig {
  const key = String(env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
  return {
    clerkPublishableKey: clerkFrontendApiHost(key) ? key : null,
    apiUrl: apiOrigin(String(env.VITE_API_URL ?? ""), { production: env.PROD === true }),
  };
}
