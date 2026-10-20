import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/react";
import { BOT_NAME } from "../brand.ts";

type Localization = NonNullable<ComponentProps<typeof ClerkProvider>["localization"]>;

// Our wording in Clerk's components: plain, sentence case, about what the person is doing here.
export const clerkLocalization = {
  signIn: { start: { subtitle: "Sign in to see your sessions." } },
  signUp: { start: { subtitle: `Create an account to bring ${BOT_NAME} into your meetings.` } },
  taskChooseOrganization: {
    createOrganization: {
      title: "Set up your organization",
      subtitle: "Sessions belong to an organization, so your team sees the same list.",
    },
    chooseOrganization: { title: "Choose an organization" },
  },
} satisfies Localization;
