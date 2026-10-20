import { ClerkProvider } from "@clerk/react";
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { clerkAppearance } from "../clerk/appearance.ts";
import { clerkLocalization } from "../clerk/localization.ts";
import { useColorMode } from "../hooks/useColorMode.ts";

// Clerk with in-app URLs (ADR 0012): its own redirects go through React Router, so the page never reloads and never
// leaves for Clerk's hosted pages. A redirect_url Clerk is handed is followed only to this app's own origin (Clerk's
// default also allows every subdomain of the instance's domain). Telemetry is off.
export function ClerkWithRouter({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  const navigate = useNavigate();
  // Clerk's parts follow the color mode through our tokens, except the bot check (Cloudflare Turnstile) in sign-up,
  // which draws itself in an iframe: it's told the mode, and "auto" (the OS's) for System.
  const [mode] = useColorMode();
  const appearance = useMemo(() => ({ ...clerkAppearance, captcha: { theme: mode === "system" ? "auto" as const : mode } }), [mode]);
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={appearance}
      localization={clerkLocalization}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
      allowedRedirectOrigins={[window.location.origin]}
      taskUrls={{ "choose-organization": "/choose-organization" }}
      telemetry={false}
    >
      {children}
    </ClerkProvider>
  );
}
