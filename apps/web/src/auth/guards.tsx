import { useAuth, useSession } from "@clerk/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { LoadingPage } from "../pages/LoadingPage.tsx";
import { StartSessionProvider } from "../sessions/StartSessionProvider.tsx";

// Where a signed-out visitor goes: sign-in, then back to the page they asked for.
function signInPath(location: { pathname: string; search: string }): string {
  const back = location.pathname + location.search;
  return back === "/" ? "/sign-in" : `/sign-in?redirect_url=${encodeURIComponent(back)}`;
}

// A page of this app to return to after sign-in, or "/". Only a path on this site, so a crafted sign-in link can't
// send someone elsewhere: it must start with one "/", and it may not hold a backslash, whitespace or a control
// character (browsers drop or rewrite those, which can turn "/<tab>/host" into "//host").
export function safeReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return /[\\\s\u0000-\u001f\u007f]/.test(raw) ? "/" : raw;
}

// Pages for members of an organization. Clerk reports a pending session (signed in, no organization chosen yet) as
// signed out, so the session's task decides: a "choose-organization" task goes to /choose-organization, no session
// goes to sign-in. The org always comes from the session token; the app never sends an org id.
export function RequireOrg() {
  const { isLoaded, isSignedIn, orgId } = useAuth();
  const { session } = useSession();
  const location = useLocation();
  // After a sign-out on this page, go to plain sign-in: the next person shouldn't land on this person's page.
  const wasSignedIn = useRef(false);
  if (isSignedIn) wasSignedIn.current = true;
  if (!isLoaded) return <LoadingPage />;
  if (!isSignedIn) {
    if (session?.currentTask?.key === "choose-organization") return <Navigate to="/choose-organization" replace />;
    return <Navigate to={wasSignedIn.current ? "/sign-in" : signInPath(location)} replace />;
  }
  if (!orgId) return <Navigate to="/choose-organization" replace />;
  return (
    <OrgSwitchWatcher orgId={orgId}>
      <StartSessionProvider>
        <Outlet />
      </StartSessionProvider>
    </OrgSwitchWatcher>
  );
}

// A session belongs to the org it was started in, so switching org on a session's page goes back to the list.
function OrgSwitchWatcher({ orgId, children }: { orgId: string; children: ReactNode }) {
  const previous = useRef(orgId);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (previous.current !== orgId) {
      previous.current = orgId;
      if (location.pathname.startsWith("/sessions/")) navigate("/", { replace: true });
    }
  }, [orgId, location.pathname, navigate]);
  return children;
}

// Sign-in and sign-up: someone already signed in goes to the page they were sent here from, or to the app.
export function RedirectIfSignedIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  if (!isLoaded) return <LoadingPage />;
  if (isSignedIn) return <Navigate to={safeReturnPath(new URLSearchParams(location.search).get("redirect_url"))} replace />;
  return <Outlet />;
}
