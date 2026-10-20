import { SignIn } from "@clerk/react";
import { AuthLayout } from "../auth/AuthLayout.tsx";

export function SignInPage() {
  return (
    <AuthLayout>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </AuthLayout>
  );
}
