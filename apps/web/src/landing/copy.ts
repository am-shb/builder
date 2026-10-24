import { BOT_NAME, PRODUCT_NAME } from "../brand.ts";

// The landing page's words. Each claim here is something the code does today (AGENTS.md, ADR 0017).
export const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

export const SIGN_UP = "/sign-up";
export const SIGN_IN = "/sign-in";

export const HERO = {
  eyebrow: "An AI teammate for your meetings",
  headline: ["Your meeting ends with a", "working prototype."] as const,
  sub: `${BOT_NAME} joins your call, listens, and builds a clickable prototype on screen while the team decides.`,
  platforms: "Built for Google Meet. Zoom and Microsoft Teams links work too.",
  // What the hero's animation shows, for people who can't see it.
  sceneSummary:
    `An example meeting. One person asks for a due date on each task, and ${BOT_NAME} adds it to the prototype on screen, ` +
    "outlined with dashes as a draft. A second person agrees, so the decision moves from pending to agreed and the " +
    "outline turns solid. A third person suggests showing overdue tasks in red, which starts a new pending decision.",
};

export { BOT_NAME, PRODUCT_NAME };
