import { SignUp } from "@clerk/react";
import { AuthLayout } from "../auth/AuthLayout.tsx";
import { usePageTitle } from "../hooks/usePageTitle.ts";

export function SignUpPage() {
  usePageTitle("Sign up");
  return (
    <AuthLayout>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthLayout>
  );
}
