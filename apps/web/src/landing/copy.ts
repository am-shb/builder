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

// The home page's title and description: the browser tab, search results and share cards (build/meta.ts).
export const HOME_TITLE = `${PRODUCT_NAME} · Your meeting ends with a working prototype`;
export const HOME_DESCRIPTION = `${PRODUCT_NAME} joins your call, listens, and builds a clickable prototype on screen while the team decides. Decisions turn agreed only when people say so.`;

export const HERO = {
  eyebrow: "An AI teammate for your meetings",
  headline: ["Your meeting ends with", "a working prototype."] as const,
  sub: `${BOT_NAME} joins your call, listens, and builds a clickable prototype on screen while the team decides.`,
  platforms: "Built for Google Meet. Zoom and Microsoft Teams links work too.",
  // What the hero's animation shows, for people who can't see it.
  sceneSummary:
    `An example meeting. One person asks for a due date on each task, and ${BOT_NAME} adds it to the prototype on screen, ` +
    "outlined with dashes as a draft. A second person agrees, so the decision moves from pending to agreed and the " +
    "outline turns solid. A third person suggests showing overdue tasks in red, which starts a new pending decision.",
};

// The demo video, self-hosted under public/ when it exists (for example "/demo.mp4"). Until then the demo section
// shows a placeholder frame.
export const DEMO_VIDEO: string | null = null;

export const BEFORE_AFTER = {
  eyebrow: "Before and after",
  title: "Leave the meeting with something you can click",
  lead: `Most meetings end with notes, and someone spends the next days turning them into a mockup. With ${PRODUCT_NAME}, the meeting itself produces it.`,
  before: {
    label: "Today",
    title: "The meeting ends with notes",
    points: [
      "A page of notes, and everyone remembering a different decision",
      "Someone spends days turning it into a mockup",
      "The next meeting reopens the same questions",
    ],
  },
  after: {
    label: `With ${PRODUCT_NAME}`,
    title: "The meeting ends with a working prototype",
    points: [
      "A clickable prototype, built on screen while you talked",
      "A decision log: what was agreed, by whom, and what is still open",
      "A handoff page with the component spec, ready for engineers",
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
      text: "Start a session with a Google Meet link. Zoom and Microsoft Teams links work too.",
    },
    {
      title: `Admit ${BOT_NAME} when it asks to join`,
      text: "It joins by name, like any guest, and posts a pinned message in the chat saying it is transcribing.",
    },
    {
      title: "Watch the prototype take shape",
      text: "It builds on a shared screen as you talk. Parts stay dashed until someone agrees, then turn solid.",
    },
  ],
};

export const FEATURES = {
  eyebrow: "Features",
  title: "Built for the way decisions really happen",
  lead: "Not a note taker. A teammate that turns the conversation into a prototype, and keeps track of what was decided.",
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
      title: "Options side by side",
      text: "When people disagree, it lays out two or three options with their tradeoffs. The room picks one out loud.",
    },
    voice: {
      title: "Steer it by voice",
      text: `Say its name to ask a question, or to click, type or go to a screen: “${BOT_NAME}, show option B.”`,
    },
    handoff: {
      title: "A handoff page for engineers",
      text: "The clickable prototype, the decision log and what's still open, with the component spec as JSON you can hand to any tool.",
    },
    teams: {
      title: "Made for teams",
      text: "Sessions belong to your organization, so everyone sees the same ones. Admins manage members, and each organization's data is kept apart.",
    },
  },
};

export const DEMO = {
  eyebrow: "Demo",
  title: "See it in a real meeting",
  lead: `A few minutes of a real call: the team talks, ${BOT_NAME} builds, and the decisions settle on screen.`,
  placeholder: "The demo video is on its way.",
};

export const AUDIENCES = {
  eyebrow: "Who it's for",
  title: "For every meeting that should end in something real",
  items: [
    { title: "Product teams", text: "Turn a planning call into a flow everyone can click through before anyone writes a spec." },
    { title: "Agencies", text: "Leave a client kickoff with a prototype, and a record of what the client agreed to." },
    { title: "Founders", text: "Go from an idea call to something your first users and investors can try." },
    { title: "Design sprints", text: "Make decision day produce a prototype, with the reasons for each choice on record." },
  ],
};

export const TRUST = {
  eyebrow: "Trust and security",
  title: "Visible in the room, careful with your data",
  lead: "A meeting is a shared space. It behaves like a guest who says what it is doing.",
  items: [
    { tag: "In the meeting", title: "It announces itself", text: `${BOT_NAME} joins by name, has to be admitted like any guest, and posts a pinned chat message saying it is transcribing.` },
    { tag: "Decisions", title: "People decide, not the model", text: "Every agreement has to be backed by what people actually said. Anything not agreed stays a draft." },
    { tag: "Your data", title: "Each organization's data is its own", text: "Every session belongs to one organization, and every request is checked against it. One organization can't see another's sessions." },
    { tag: "Spending", title: "Limits on every meeting", text: "Each session has a time and a spending limit. When one is reached, it says why in the chat, leaves, and keeps what was built." },
    { tag: "Recording", title: "Clear about data", text: "It asks for the transcript, not an audio or video recording. Transcripts, prompts and model output are never written to logs." },
  ],
  logTitle: "What it promises",
  logNote: "True today, in every meeting",
  privacyLink: "How we handle data",
};

export const PRICING = {
  eyebrow: "Pricing",
  title: "Start free. Pay when it's part of every meeting.",
  note: "Pricing for paid plans is announced at launch. Plans include meeting hours, extra usage is billed per minute, and admins can set a spending limit.",
  plans: [
    {
      name: "Free",
      price: "$0",
      blurb: "Try it in your own meetings.",
      points: ["A small allowance of meeting minutes", "No card needed", "Stops at the limit; never billed"],
      cta: { label: "Start free", href: SIGN_UP },
    },
    {
      name: "Pro",
      price: "Priced at launch",
      blurb: "For a team that meets every week.",
      points: ["Meeting hours included each month", "Extra minutes billed per minute", "A monthly spending limit you set"],
      cta: { label: "Get early access", href: SIGN_UP },
    },
    {
      name: "Team",
      price: "Priced at launch",
      blurb: "For an organization with many teams.",
      points: ["Everything in Pro", "Sessions shared across your organization", "Admin and member roles"],
      cta: { label: "Start with your team", href: SIGN_UP },
    },
  ],
};

export const FAQ = {
  eyebrow: "FAQ",
  title: "Questions, answered",
  items: [
    {
      q: "Is it recording the meeting?",
      a: `It transcribes the call so it can follow what people decide. It doesn't ask for an audio or video recording. When it joins, it posts a pinned message in the meeting chat saying it is transcribing, and it has to be admitted like any guest.`,
    },
    {
      q: "Which meeting platforms does it work with?",
      a: "It's built for Google Meet. Zoom and Microsoft Teams links are accepted too, but so far it has been tested most on Google Meet.",
    },
    {
      q: "Does it talk during the meeting?",
      a: `Only a little: when someone says its name, when the room seems stuck, or to confirm a choice between options. Its replies are short, and anyone can interrupt it.`,
    },
    {
      q: "Who owns the prototype?",
      a: "Each session belongs to your organization. Everyone in it can open the prototype, the decision log and the handoff page, and download the component spec as JSON. The terms that make this formal are being written.",
    },
    {
      q: "What happens to our data?",
      a: "The transcript, the prototype and the decisions are stored with your organization's session, and only your organization can see them. The transcript is processed by the services that run the bot and the AI models. Transcripts are never written to logs. Settings for how long data is kept are coming before launch.",
    },
    {
      q: "How much does it cost?",
      a: "You can start free with a small allowance of meeting minutes and no card. Paid plans are announced at launch: they include meeting hours, extra usage is billed per minute, and admins can set a spending limit.",
    },
  ],
};

export const FINAL_CTA = {
  title: `Bring ${BOT_NAME} to your next meeting`,
  text: "Paste a link, let it in, and leave with a prototype and a record of what was decided.",
};

export const FOOTER = {
  tagline: `${PRODUCT_NAME} joins your meeting and builds the prototype while you decide.`,
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
    ],
  },
  terms: {
    title: "Terms",
    intro: "This page is a placeholder. The terms of service will be published before launch.",
    points: ["The product is an early version and is still being built."],
  },
};

export { BOT_NAME, PRODUCT_NAME };
