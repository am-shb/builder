import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/react";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

// Clerk's sign-in, sign-up, org switcher and user menu follow our tokens (ADR 0013), so they match in light and dark
// without a Clerk theme package. Their styles go in the `clerk` CSS layer, which globals.css orders before Tailwind's
// utilities. Used by ClerkProvider from W2 on.
export const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--on-primary)",
    colorBackground: "var(--surface)",
    colorForeground: "var(--ink)",
    colorMuted: "var(--sunk)",
    colorMutedForeground: "var(--ink-2)",
    colorNeutral: "var(--ink)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--hair)",
    colorRing: "var(--primary)",
    colorDanger: "var(--danger)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warn-ink)",
    colorModalBackdrop: "var(--scrim)",
    fontFamily: "var(--font-sans)",
    fontFamilyButtons: "var(--font-sans)",
    borderRadius: "var(--radius-field)",
  },
  // Our classes on Clerk's parts, so its cards and buttons match ours: the one elevation, pill buttons, our field.
  elements: {
    cardBox: "rounded-panel shadow-elevated",
    // The box carries the one elevation; the card inside it gets none, so there's no seam above the footer.
    card: "shadow-none",
    dividerLine: "bg-input/50",
    formButtonPrimary: "min-h-12 rounded-full bg-primary text-label font-semibold shadow-glow after:hidden hover:bg-primary-hover",
    socialButtonsBlockButton: "min-h-11 rounded-full border-0 shadow-outline hover:bg-sunk",
    socialButtonsBlockButtonText: "text-label font-semibold text-ink",
    // Clerk's small secondary buttons (Upload, Manage) as our outline pill, 44px.
    avatarImageActionsUpload: "min-h-11 rounded-full px-4 text-label font-semibold text-ink shadow-outline hover:bg-sunk",
    organizationSwitcherPopoverActionButton__manageOrganization: "min-h-11 rounded-full px-4 text-ink shadow-outline hover:bg-sunk",
    // The phone field is a box holding a country picker and an input: the box gets the border, the input none.
    phoneInputBox: "min-h-12 rounded-field border-[1.5px] border-input bg-surface shadow-none focus-within:border-primary focus-within:shadow-[inset_0_0_0_0.5px_var(--primary),0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)] [&_input]:border-0 [&_input]:shadow-none",
    formFieldInput: "min-h-12 rounded-field border-[1.5px] border-input bg-surface shadow-none focus:border-primary focus:shadow-[inset_0_0_0_0.5px_var(--primary),0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
    // A long org name is cut short with an ellipsis, so the account button stays on screen on a 320px phone.
    organizationSwitcherTrigger: "h-11 min-w-0 max-w-full rounded-full py-0 pr-2.5 pl-1.5 hover:bg-sunk focus-visible:outline-2 focus-visible:outline-primary",
    organizationPreviewAvatarBox: "size-[30px] rounded-full bg-accent-tint",
    organizationPreviewMainIdentifier: "truncate max-w-[40vw] text-sm font-medium text-ink md:max-w-[260px]",
    organizationSwitcherPopoverCard: "ring-1 ring-hair",
    organizationSwitcherPopoverActionButton: "min-h-12 text-ink",
    userButtonPopoverCard: "ring-1 ring-hair",
    userButtonPopoverActionButton: "min-h-12 text-ink",
    userButtonTrigger: "grid size-11 place-items-center rounded-full hover:bg-sunk focus-visible:outline-2 focus-visible:outline-primary",
    userButtonAvatarBox: "size-[30px] bg-accent-tint",
  },
} satisfies Appearance;
