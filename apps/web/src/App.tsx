import { ClerkFailed, ClerkLoaded, ClerkLoading } from "@clerk/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ClerkWithRouter } from "./auth/ClerkWithRouter.tsx";
import { RedirectIfSignedIn, RequireOrg } from "./auth/guards.tsx";
import { readConfig, type WebConfig } from "./config.ts";
import { ChooseOrganizationPage } from "./pages/ChooseOrganizationPage.tsx";
import { ClerkUnavailablePage } from "./pages/ClerkUnavailablePage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoadingPage } from "./pages/LoadingPage.tsx";
import { NotConfiguredPage } from "./pages/NotConfiguredPage.tsx";
import { SessionPage } from "./pages/SessionPage.tsx";
import { SignInPage } from "./pages/SignInPage.tsx";
import { SignUpPage } from "./pages/SignUpPage.tsx";

// The routes (plan WD2). Sign-in and sign-up are Clerk's, on our own URLs; everything else needs an organization.
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RedirectIfSignedIn />}>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
      </Route>
      <Route path="/choose-organization" element={<ChooseOrganizationPage />} />
      <Route element={<RequireOrg />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App({ config = readConfig() }: { config?: WebConfig }) {
  if (!config.clerkPublishableKey || !config.apiUrl) return <NotConfiguredPage />;
  return (
    <BrowserRouter>
      <ClerkWithRouter publishableKey={config.clerkPublishableKey}>
        <ClerkLoading><LoadingPage /></ClerkLoading>
        <ClerkFailed><ClerkUnavailablePage /></ClerkFailed>
        <ClerkLoaded><AppRoutes /></ClerkLoaded>
      </ClerkWithRouter>
    </BrowserRouter>
  );
}
