import { ClerkProvider } from "@clerk/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { clerkAppearance } from "../clerk/appearance.ts";
import { clerkLocalization } from "../clerk/localization.ts";

// Clerk with in-app URLs (ADR 0012): its own redirects go through React Router, so the page never reloads and never
// leaves for Clerk's hosted pages. A redirect_url Clerk is handed is followed only to this app's own origin (Clerk's
// default also allows every subdomain of the instance's domain). Telemetry is off.
export function ClerkWithRouter({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={clerkAppearance}
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
