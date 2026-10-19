# 0013: The web app's visual design: Tailwind CSS with Radix-based components, one token set, mobile-first

- **Status:** proposed
- **Date:** 2026-10-19
- **Area:** web (`apps/web`)

## Context
UI and design are a judging criterion at the hackathon, and the app will be shown to investors afterwards. So the web
app has to look modern and polished, be fully responsive from a 360px phone to a large desktop, and feel like a real
app on a phone. ADR 0012 settled the stack (Vite + React, a Render static site, Clerk) but not how the app looks; the
web README lists the design system as an open decision.

The repo has no design system or brand guide for the product's own pages. The engine's pages each carry their own
colors inline: the stage (dark, accent `#8fb0ff`, green for agreed, amber for pending, violet for questions), the
hand-off page (light and dark, accent `#2447d6`, amber warnings, 12px corners, system font) and the v0 operator
pages, which the web app replaces. `apps/engine/public/renderer/theme.css` is the kit the bot builds prototypes with,
sized for a 1280×720 screenshare, not product chrome. The product name and domain aren't decided. The submission is
due 2026-10-25.

## Options considered
1. **Plain CSS with tokens and our own components.** No dependencies and full control. Reaching a polished result
   (dialogs, bottom sheets, toasts, focus handling, menus) means building and testing accessible behavior ourselves,
   which doesn't fit the deadline next to five screens.
2. **Tailwind CSS with shadcn/ui-style components on Radix primitives.** Radix handles the hard accessibility
   behavior (focus trapping, escape, scroll lock, ARIA for dialogs, menus and tooltips). The component source is
   copied into our repo, so we own and restyle it. Tailwind keeps spacing, type and color on one scale, and mobile-first
   breakpoints are built in. It's the most common stack for modern React apps, so the result looks current.
3. **A full component library (MUI, Mantine, Chakra).** Fast to assemble, but it brings its own recognizable look,
   is harder to match to Clerk, and is heavier.

## Decision
Option 2, with these rules.

### Packages
Added to `apps/web` in the scaffold (W1), pinned exactly, so the design work never changes the lockfile again:
- Runtime: `radix-ui` (the primitives), `class-variance-authority`, `clsx` and `tailwind-merge` (component variants
  and class merging), `lucide-react` (icons), `sonner` (toasts), and `@fontsource-variable/geist` and
  `@fontsource-variable/geist-mono` (self-hosted fonts).
- Build and test: `tailwindcss` and `@tailwindcss/vite`, `tw-animate-css` (enter and exit animations), `axe-core`
  (accessibility checks), and `playwright-core` (screenshots and in-browser checks against a local dev server, using the
  installed Chrome; it downloads no browser and never runs in `npm test`).
- **Not added:** the `shadcn` CLI package (dozens of dependencies; the few components are copied from shadcn's
  open-source registry and adapted by hand), `vaul` (no release since December 2024; the bottom sheet is a Radix
  Dialog styled as a sheet), an animation library (CSS transitions and `tw-animate-css` are enough), and
  `@clerk/themes` (Clerk is themed with our CSS variables instead).

Nothing here changes the CSP: Tailwind's output, the fonts and the icons are bundled files served from `'self'`, and
the inline styles that Radix and `sonner` set are already allowed by `style-src 'unsafe-inline'` (ADR 0012).

### Color
One set of semantic tokens (`--background`, `--card`, `--primary`, `--success`, ...) in
`apps/web/src/styles/globals.css`, defined in OKLCH, with a light and a dark value each. Tailwind's theme reads them,
and no component uses a raw color. The palette is fresh but related to the engine's pages: an indigo primary near the
hand-off page's blue, a periwinkle primary in dark mode that echoes the stage's accent, a violet second stop taken
from the stage's question color, and green and amber that echo the stage's agreed and pending.

| Token | Light | Dark | Used for |
|---|---|---|---|
| background | `#f9fafd` | `#0b0e15` | page |
| card | `#ffffff` | `#13171f` | cards, sheets, dialogs |
| muted | `#f1f3f9` | `#1c202a` | subtle fills, skeletons |
| foreground | `#111826` | `#f2f3f7` | text |
| muted-foreground | `#5b6375` | `#a2a8b5` | secondary text |
| border | `#dde1ea` | `#292e38` | dividers and card edges (decorative) |
| input | `#858c9c` | `#626978` | form field borders (3:1 or more) |
| primary | `#4f52e7` | `#8d9eff` | primary actions, links, focus ring |
| primary-foreground | `#fcfcfc` | `#0c0e1c` | text on primary |
| violet | `#914de6` | `#ba93fb` | the brand gradient's second stop, used sparingly |
| success | `#007f4e` | `#56d089` | "In the meeting" |
| warning | `#a45e00` on `#fff4d7` | `#f5b34c` on `#2d1f0a` | "Check the meeting", the unknown-outcome warning |
| danger | `#d01a34` | `#f96f70` | failures, destructive actions |

Measured WCAG contrast: body and secondary text 5.4:1 or more on every surface in both modes, text on primary 5.5:1
(light) and 7.7:1 (dark), each status color 4.5:1 or more on cards, and form field borders 3:1 or more. The
light/dark choice follows the system (`prefers-color-scheme`). There's no in-app toggle, because it would need
browser storage, which ADR 0012 rules out; the dev-only preview page forces a mode with `?theme=`.

### Type, shape and space
- **Geist** (variable, self-hosted, Latin subset) for text, Geist Mono for codes and ids. Body 16px (also stops iOS
  zooming into inputs), small 14px, caption 12px, headings 20, 24 and 30px on phones up to 36px on desktop, with tight
  tracking. Times and amounts use tabular numbers.
- Radius 10px for buttons and inputs, 14px for cards, 20px for the top corners of bottom sheets, full for badges.
- A 4px spacing scale. Page gutters 16px on phones, 24px on tablets, 32px on desktop. Content at most 1120px wide.
- Elevation: soft layered shadows in light mode; in dark mode, lighter surfaces and borders instead of shadows.

### Brand
`PRODUCT_NAME` as a wordmark next to a mark: a rounded square with the primary-to-violet gradient holding the name's
first letter, so it follows a rename. The favicon is the same tile without a letter. No other logo until the name is
decided.

### Layout and navigation
- **Breakpoints:** phone-first from 360px, `sm` 640, `md` 768, `lg` 1024, `xl` 1280. No sideways scrolling at any width;
  long values (meeting links, ids) wrap or truncate with the full value available.
- **This slice has one top-level page,** Sessions; a session's detail is a child of it, and organizations and the
  account live in Clerk's switcher and user menu. A bottom tab bar with one or two tabs would look empty and add a tap
  for nothing, so there is none for now:
  - **Phone:** a sticky top bar (mark, org switcher, user button). The primary action, "New session", is a full-width
    button in a sticky bottom bar, in thumb reach and above the safe-area inset, and opens the start form in a bottom
    sheet. The detail page is a pushed screen with a back button in the top bar, and slides in.
  - **Tablet and desktop:** the same top bar, with the start form inline in a card above the session list, and dialogs
    centered instead of sheets.
  - **Later:** when the library, billing and settings pages arrive (three to five top-level pages), phones get a bottom
    tab bar with icons and labels, and desktop gets a sidebar. The app shell keeps a slot for it.
- One `ResponsiveModal`: a bottom sheet below `md`, a centered dialog from `md`. The start form on phones and the
  "Start anyway?" confirmation use it.

### States and feedback
- **Loading:** skeletons shaped like the content (list rows, the detail page), shown after 150 ms so fast replies
  don't flash. Buttons show a spinner and a busy label ("Starting…") while their request runs.
- **Empty:** an icon in a soft gradient circle, a one-line headline, one line of help and the primary action.
- **Errors:** a callout with an icon, our text from the plan's error table and its action. Page-level failures (not
  configured, a missing session) get a centered state with a way back.
- **Toasts** (`sonner`) only for short, non-critical confirmations: "Link copied", "Session started". Never the only
  place an error or warning appears; the unknown-outcome warning is always a persistent callout.
- **Status badges:** a colored dot plus the label, never color alone. Active statuses (starting, joining, in the
  meeting) have a soft pulsing dot.

### Motion
Short and subtle: 150–250 ms, ease-out. Sheets slide up, dialogs fade and scale from 98%, a pushed screen slides 16px
and fades, lists fade in. Buttons press to 98% scale. Everything that moves is behind `motion-safe:` and stops under
`prefers-reduced-motion`, including skeleton shimmer and pulsing dots.

### Feeling like an app on a phone
`viewport-fit=cover` with safe-area insets, `theme-color` for light and dark, touch targets 44px or more, pressed states
instead of tap highlights, `touch-action: manipulation`, scroll locked behind sheets, and `inputmode="url"` on the
meeting link field. No installable app (PWA) until the name and icons exist.

### Accessibility (WCAG 2.2 AA)
The contrast above; a visible 2px focus ring on every interactive element; real labels with errors linked by
`aria-describedby`; headings in order and landmarks (`header`, `main`, `nav`); `lang` set; start results announced in a
`role="status"` region and the unknown-outcome warning in `role="alert"`; dialogs and sheets from Radix (focus trapped
and restored, Escape closes); targets 24px or more everywhere and 44px on touch layouts; nothing depends on hover.
Checked by `axe-core` in the tests (structure, names and roles; jsdom can't compute contrast) and in a real browser
by the screenshot script (contrast included).

### Clerk
`ClerkProvider`'s `appearance.variables` point at the same CSS variables (`colorPrimary: "var(--primary)"`, background,
foreground, muted, input, danger, success, warning, font and radius), so sign-in, sign-up, the org switcher and the
user menu follow the theme, dark mode included. Clerk's `cssLayerName` option puts its styles in a `clerk` CSS layer
that `globals.css` orders before Tailwind's utilities, so our classes can override them. The exact variable names are checked against Clerk's docs when this is built.

### How the look stays consistent
- Screens only compose the components in `src/components/`; no one-off colors or sizes. A test fails on a raw color
  (hex, `rgb(`, `oklch(`) outside `globals.css` and the favicon.
- A dev-only preview page, `/_design`, shows every component and state in light and dark. It isn't in the production
  build.
- **Approval before screens:** the design foundation (W1b) is shown as screenshots of `/_design` at phone and desktop
  widths, light and dark, and approved before the screen steps start.
- **Review for each screen step:** its screens are inspected in a real browser at 360, 390, 768, 1280 and 1536px wide,
  light and dark, with reduced motion on and off. A separate review then judges the screenshots for polish,
  consistency and responsiveness, and what it finds is fixed before the step is reported done.

## Consequences
- The app looks current and consistent with little custom CSS, and accessible behavior for dialogs, sheets and menus
  comes from Radix rather than from us.
- We own the copied component code. Updates to shadcn's registry don't reach us unless we copy them.
- Markup carries Tailwind class strings, and `class-variance-authority` keeps them in one place per component.
- More dependencies than ADR 0012 alone, all in the one lockfile change in W1. That change redeploys the engine and the
  api (ADR 0012), so W1 is merged when no meeting is running.
- The palette and the wordmark are placeholders for a brand that isn't decided. Changing the brand means editing the
  tokens and `src/brand.ts`, not the screens.
- Follow-ups: a bottom tab bar and a sidebar when the app has three to five top-level pages; an in-app theme toggle if
  a place to store the choice is agreed; a PWA manifest and icons once the name is chosen.
