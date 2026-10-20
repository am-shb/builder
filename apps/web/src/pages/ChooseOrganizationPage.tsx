import { OrganizationList, TaskChooseOrganization, useAuth, useSession } from "@clerk/react";
import { Navigate } from "react-router";
import { AuthLayout } from "../auth/AuthLayout.tsx";
import { LoadingPage } from "./LoadingPage.tsx";

// Every session belongs to an organization (ADR 0006), so a new user creates or joins one before the app opens. With a
// pending "choose-organization" task, Clerk's task component; signed in with no organization and no task (rare: after
// leaving the last one elsewhere), the organization list. Personal accounts are hidden.
export function ChooseOrganizationPage() {
  const { isLoaded, isSignedIn, orgId } = useAuth();
  const { session } = useSession();
  if (!isLoaded) return <LoadingPage />;
  const pendingTask = session?.currentTask?.key === "choose-organization";
  if (!pendingTask && !isSignedIn) return <Navigate to="/sign-in" replace />;
  if (!pendingTask && orgId) return <Navigate to="/" replace />;
  return (
    <AuthLayout variant="organization">
      {pendingTask ? (
        <TaskChooseOrganization redirectUrlComplete="/" />
      ) : (
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
      )}
    </AuthLayout>
  );
}
