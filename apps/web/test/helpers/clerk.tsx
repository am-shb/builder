// Clerk, mocked at the module level (plan: "Testing"). Its script is never loaded. A test picks a state with
// `setClerk(...)`; components render a test id, and ClerkProvider records its props.
import type { ReactNode } from "react";
import { vi } from "vitest";

export type ClerkState = {
  loaded: boolean;
  // A signed-in session (with or without an org), a pending one (signed in, no org chosen), or none.
  session: "none" | "pending" | "active";
  orgId: string | null;
  failed?: boolean;
};

export const clerk = {
  state: { loaded: true, session: "none", orgId: null } as ClerkState,
  providerProps: null as Record<string, unknown> | null,
};

export function setClerk(state: Partial<ClerkState>) {
  clerk.state = { loaded: true, session: "none", orgId: null, ...state };
}

const stub = (name: string) => (props: Record<string, unknown>) => (
  <div data-testid={name} data-props={JSON.stringify(props)} />
);

vi.mock("@clerk/react", () => ({
  ClerkProvider: (props: Record<string, unknown> & { children: ReactNode }) => {
    const { children, ...rest } = props;
    clerk.providerProps = rest;
    return <>{children}</>;
  },
  ClerkLoading: ({ children }: { children: ReactNode }) => (clerk.state.loaded ? null : <>{children}</>),
  ClerkLoaded: ({ children }: { children: ReactNode }) => (clerk.state.loaded && !clerk.state.failed ? <>{children}</> : null),
  ClerkFailed: ({ children }: { children: ReactNode }) => (clerk.state.failed ? <>{children}</> : null),
  // Like Clerk's default: a pending session counts as signed out, with no user or org.
  useAuth: () => {
    const { loaded, session, orgId } = clerk.state;
    const active = session === "active";
    return { isLoaded: loaded, isSignedIn: loaded ? active : undefined, userId: active ? "user_1" : null, orgId: active ? orgId : null };
  },
  useSession: () => {
    const { loaded, session } = clerk.state;
    if (!loaded || session === "none") return { isLoaded: loaded, session: null };
    return { isLoaded: true, session: { status: session, currentTask: session === "pending" ? { key: "choose-organization" } : undefined } };
  },
  SignIn: stub("clerk-sign-in"),
  SignUp: stub("clerk-sign-up"),
  TaskChooseOrganization: stub("clerk-task-choose-organization"),
  OrganizationList: stub("clerk-organization-list"),
  // Like Clerk's: a button that shows the org's name but has a different label.
  OrganizationSwitcher: (props: Record<string, unknown>) => (
    <div data-testid="clerk-organization-switcher" data-props={JSON.stringify(props)}>
      <button type="button" aria-label="Open organization switcher">Org A</button>
    </div>
  ),
  UserButton: stub("clerk-user-button"),
}));
