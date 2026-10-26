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

// The Android app's download, shown only when the build knows its address (VITE_ANDROID_APP_URL; ADR 0012, amended).
export const ANDROID_APP = {
  lead: "Also on your phone:",
  label: "Get the Android app",
  footer: "Android app",
};

// The home page's title and description: the browser tab, search results and share cards (build/meta.ts).
export const HOME_TITLE = `${PRODUCT_NAME} · The AI product manager that builds what you decide`;
export const HOME_DESCRIPTION = `${PRODUCT_NAME} joins your call like a product manager: it asks who the app is for, lays out the trade-offs when you disagree, and builds a clickable prototype while the team decides.`;

export const HERO = {
  headline: ["Your meeting ends with", "a working prototype."] as const,
  // The subheadline opens with what the product is, in a stronger ink, then what it does.
  subLead: `${BOT_NAME} is an AI product manager for your meetings.`,
  sub: "Not a note taker, not a prompt box. It joins the call, asks who the app is for, lays out the trade-offs when you disagree, and builds the clickable prototype as you decide.",
  platforms: "Built for Google Meet. Zoom and Microsoft Teams links work too.",
  // What the hero's animation shows, for people who can't see it.
  sceneSummary:
    "Two example meetings, one after the other. In the first, a team designs a café's ordering app: a phone screen " +
    `with today's menu as photo cards with prices, which ${BOT_NAME} draws as a draft and Theo agrees to. Then Sana ` +
    "wants the fall special at the top for its higher margin, and Ravi wants Order again at the top because most " +
    `orders are repeats. ${BOT_NAME} shows both side by side as A and B, each with who backs it and its trade-off. ` +
    `Theo picks B, and B is marked as picked by Theo. ${BOT_NAME} only asks whether everyone is OK with B; Nora ` +
    "agrees, and the decision is recorded as agreed by Theo and Nora. In the second, a sales review, Maya asks for " +
    `monthly revenue as a bar chart, and ${BOT_NAME} adds it to the prototype on screen, outlined with dashes as a ` +
    "draft. Jonah agrees, so the decision moves from pending to agreed and the outline turns solid. In the same way " +
    "the team adds revenue by region, a table of top customers and a card for the best month.",
};

// The demo video's YouTube embed (the privacy-enhanced host, which sets no cookies until it plays). null shows a
// placeholder frame instead.
export const DEMO_VIDEO: string | null = "https://www.youtube-nocookie.com/embed/ryx6aF-kCfc";

export const BEFORE_AFTER = {
  eyebrow: "Before and after",
  title: "Leave the meeting with something you can click",
  lead: `Most meetings end with notes, loose ends and a mockup someone builds days later. With ${PRODUCT_NAME}, the questions get asked in the room, and the meeting produces the prototype.`,
  before: {
    label: "Today",
    title: "The meeting ends with notes",
    points: [
      "A page of notes, and everyone remembering a different decision",
      "Someone spends days turning it into a mockup",
      "Open questions get lost, and the next meeting reopens them",
    ],
  },
  after: {
    label: `With ${PRODUCT_NAME}`,
    title: "The meeting ends with a working prototype",
    points: [
      "A clickable prototype, built on screen while you talked",
      "Disagreements laid out as options with their trade-offs, and open questions kept in view",
      "A decision log and a handoff page with the component spec, ready for engineers",
    ],
  },
};

export const STEPS = {
  eyebrow: "How it works",
  title: "Three steps, then just talk",
  lead: "No setup in the meeting itself. Start a session, let the bot in, and keep the conversation going.",
  items: [
    {
      title: "Paste the meeting link",
      text: "Start a session with your meeting's link. That's the whole setup.",
    },
    {
      title: `Admit ${BOT_NAME} when it asks to join`,
      text: "It asks to join like any guest. Once you let it in, it starts listening.",
    },
    {
      title: "Watch the prototype take shape",
      text: "It builds on a shared screen as you talk. Parts stay dashed until someone agrees, then turn solid.",
    },
  ],
};

export const FEATURES = {
  eyebrow: "Features",
  title: "A product manager's habits, built in",
  lead: "Not a note taker. It asks what you're building and for whom, keeps the open questions in view, lays out the trade-offs, and builds what the room agrees on.",
  items: {
    prototype: {
      title: "A live prototype, not a transcript",
      text: "Screens, components and clicks, built on a shared screen while people talk. When the call ends, it's still there to click through.",
    },
    grounded: {
      title: "Agreed means someone said so",
      text: "A decision only turns agreed when another person supports it, or nobody objects for 30 seconds. It never decides on its own.",
    },
    options: {
      title: "Trade-offs, side by side",
      text: "When people disagree, it lays out two or three options, each with its trade-off in one line. If the debate stalls, it asks which matters more. The room picks.",
    },
    voice: {
      title: "Ask it what it thinks",
      text: "Say its name and ask. It gives a clear view and the reason, then hands it back with one question. It can also click, type or go to a screen for you.",
    },
    handoff: {
      title: "A handoff page for engineers",
      text: "The clickable prototype, the decision log and what's still open, with the component spec as JSON you can hand to any tool.",
    },
    teams: {
      title: "Made for teams",
      text: "Create an organization and invite your teammates. Everyone sees the same sessions, and admins manage who's in.",
    },
  },
};

export const DEMO = {
  eyebrow: "Demo",
  title: "See it in a real meeting",
  lead: `A few minutes of a real call: the team talks, ${BOT_NAME} builds, and the decisions settle on screen.`,
  placeholder: "The demo video is on its way.",
};

export const TRUST = {
  eyebrow: "Trust and security",
  title: "Visible in the room, careful with your data",
  lead: "A meeting is a shared space. It behaves like a guest who says what it is doing.",
  items: [
    { tag: "In the meeting", title: "It announces itself", text: `${BOT_NAME} joins by name, waits to be admitted, and pins a chat message saying it is transcribing.` },
    { tag: "Spending", title: "Limits on every meeting", text: "At its time or spending limit, it says why in the chat, leaves, and keeps what was built." },
    { tag: "Recording", title: "A transcript, not a recording", text: "It asks for the transcript, not an audio or video recording, and never writes transcripts, prompts or model output to logs." },
  ],
  logTitle: "What it promises",
  logNote: "True today, in every meeting",
  privacyLink: "How we handle data",
};

export const PRICING = {
  eyebrow: "Pricing",
  title: "Start free. Pay when it's part of every meeting.",
  free: {
    name: "Free",
    price: "$0",
    blurb: "Try it in your own meetings.",
    points: ["A small allowance of meeting minutes", "No card needed", "Stops at the limit; never billed"],
    cta: { label: "Start free", href: SIGN_UP },
  },
  paid: "Paid plans for teams include meeting hours, bill extra use by the minute, and let an admin set a spending limit.",
};

export const FAQ = {
  eyebrow: "FAQ",
  title: "Questions, answered",
  items: [
    {
      q: "Which meeting platforms does it work with?",
      a: "It's built for Google Meet. Zoom and Microsoft Teams links are accepted too, but so far it has been tested most on Google Meet.",
    },
    {
      q: "Will it push back on our ideas?",
      a: "When it helps. It stays quiet while you talk. Ask it by name and it gives a straight view with the reason. If you're stuck on a disagreement or a question nobody picks up, it names the trade-off or suggests a way forward. It never decides for you: the room does.",
    },
    {
      q: "Does it talk during the meeting?",
      a: `It opens with one question: what you're building and who it's for. After that, only when someone says its name, when the room seems stuck, or to confirm a choice between options. Its replies are short, and anyone can interrupt it.`,
    },
    {
      q: "Who owns the prototype?",
      a: "Each session belongs to your organization. Everyone in it can open the prototype, the decision log and the handoff page, and download the component spec as JSON. The terms that make this formal are being written.",
    },
    {
      q: "What happens to our data?",
      a: "The transcript, the prototype and the decisions are stored with your organization's session, and only your organization can see them. The transcript is processed by the services that run the bot and the AI models. Settings for how long data is kept are coming before launch.",
    },
  ],
};

export const FINAL_CTA = {
  title: `Bring ${BOT_NAME} to your next meeting`,
  text: "Paste a link, let it in, and leave with a prototype and a record of what was decided.",
};

export const FOOTER = {
  tagline: `${PRODUCT_NAME} sits in your meeting like a product manager, and builds the prototype while you decide.`,
  builtAt: "Built at Build North 2026",
};

export const LEGAL = {
  privacy: {
    title: "Privacy",
    intro: "This page is a placeholder. The full privacy policy will be published before launch. Here is what is true today.",
    points: [
      `When ${BOT_NAME} is admitted to a meeting, it receives the meeting's transcript. It doesn't ask for an audio or video recording.`,
      "The transcript, the prototype, the decisions and what each meeting cost are stored with your organization's session. Only your organization can see them.",
      "The transcript is processed by the services that run the meeting bot and the AI models.",
      "Transcripts, prompts and model output are never written to logs.",
      "There is no setting yet for how long data is kept. It is coming before launch.",
      "The demo video on the home page is played by YouTube, from its privacy-enhanced youtube-nocookie.com player.",
    ],
  },
  terms: {
    title: "Terms",
    intro: "This page is a placeholder. The terms of service will be published before launch.",
    points: ["The product is an early version and is still being built."],
  },
};

export { BOT_NAME, PRODUCT_NAME };
