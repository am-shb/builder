import { SignUp } from "@clerk/react";
import { AuthLayout } from "../auth/AuthLayout.tsx";

export function SignUpPage() {
  return (
    <AuthLayout>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthLayout>
  );
}
