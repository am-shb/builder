import { SignIn } from "@clerk/react";
import { AuthLayout } from "../auth/AuthLayout.tsx";
import { usePageTitle } from "../hooks/usePageTitle.ts";

export function SignInPage() {
  usePageTitle("Sign in");
  return (
    <AuthLayout>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </AuthLayout>
  );
}
