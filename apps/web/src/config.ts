// The web app's two settings (ADR 0012), both public by design and built into the JavaScript. A missing or malformed
// one turns the app into a "not configured" page instead of failing the build.
export type WebConfig = { clerkPublishableKey: string | null; apiUrl: string | null };

export function readConfig(env: Record<string, string | boolean | undefined> = import.meta.env): WebConfig {
  const key = String(env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
  const api = String(env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  return {
    clerkPublishableKey: /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(key) ? key : null,
    apiUrl: /^https?:\/\/[^/?#\s]+$/.test(api) ? api : null,
  };
}
