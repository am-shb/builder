# 0013: The web app's visual design: "Boardroom", our own look on Tailwind CSS and Radix behavior

- **Status:** proposed
- **Date:** 2026-10-19 (rewritten on 2026-10-20 for the approved direction)
- **Area:** web (`apps/web`)

## Context
UI and design are a judging criterion at the hackathon, and the app will be shown to investors afterwards. It has to
look modern, polished and distinctive, be fully responsive from a 360px phone to a large desktop, feel like a real app
on a phone, and meet WCAG 2.2 AA in light and dark mode. ADR 0012 settled the stack (Vite + React, a Render static site,
Clerk) but not the look; the web README lists the design system as an open decision.

The repo has no design system for the product's own pages. The engine's pages carry their own colors inline: the
stage (dark, an accent near `#8fb0ff`, green for agreed, amber for pending) and the hand-off page (light and dark, a blue
accent, 12px corners). The product has one visual rule of its own, from the stage: **dashed means still being
decided, solid means agreed.** The product name and domain aren't decided.

Three directions were built as static previews and compared at 390px and 1280px in light and dark: "Blueprint" (bold
ultramarine, drafting stamps), "Boardroom" (calm, premium, minimal) and "Huddle" (warm, colorful tiles). Each was
reviewed for polish and originality by a separate review. **Boardroom was chosen**, then refined (status visibility,
row structure, hierarchy, signature details, the empty state) and reviewed again. The default shadcn/ui look (grey
cards with thin borders, default buttons) was ruled out.

## Options considered
1. **Plain CSS with our own components.** Full control, but accessible dialogs, sheets, menus and toasts by hand.
2. **Tailwind CSS for layout and tokens, Radix primitives for behavior, our own visual design on top.** Radix handles
   focus trapping, escape, scroll lock and ARIA. The components are ours, so nothing looks like a template.
3. **A full component library (MUI, Mantine, Chakra, or shadcn/ui as shipped).** Fast, but its look is recognizable.

## Decision
Option 2, with the Boardroom design.

### Packages
Added to `apps/web` in the scaffold (W1), pinned exactly, so the design work doesn't change the lockfile again:
- Runtime: `radix-ui` (behavior and accessibility only), `class-variance-authority`, `clsx` and `tailwind-merge`
  (variants and class merging), `lucide-react` (icons), `sonner` (toasts), `@fontsource-variable/schibsted-grotesk`
  (the one typeface, self-hosted).
- Build and test: `tailwindcss` and `@tailwindcss/vite`, `tw-animate-css` (enter and exit animations), `axe-core`
  (accessibility checks), `playwright-core` (screenshots and in-browser checks against a local dev server with the
  installed Chrome; it downloads no browser and never runs in `npm test`).
- **Not added:** the `shadcn` CLI and its registry styles, `vaul` (no release since December 2024; the bottom sheet
  is a Radix Dialog), an animation library, `@clerk/themes`.

Nothing here changes the CSP: Tailwind's output, the font and the icons are bundled and served from `'self'`, and the
inline styles Radix and `sonner` set are already allowed by `style-src 'unsafe-inline'` (ADR 0012).

### Character
Calm, premium and minimal. The boldness is spent in one place: **each session is identified by its meeting code, set
large** (`kfp-qzwd-nre`), the way a good watch face makes the numerals the design. Everything around it is quiet. No
borders on surfaces, no grey card stacks, no gradient washes.

### Color
Semantic tokens in `apps/web/src/styles/globals.css`, with a light and a dark value each; the mode follows the system
(`prefers-color-scheme`). Components use tokens only; a test fails on a raw color anywhere else.

| Token | Light | Dark | Used for |
|---|---|---|---|
| background | `#f4f6f5` porcelain | `#0f1513` forest night | page |
| surface | `#ffffff` | `#1b2421` | the start panel, sheets, dialogs, the empty state |
| sunk / plate / hair | `#e9eeec` / `#e6ecea` / `#dbe2df` | `#1f2a26` / `#18211e` / `#26302c` | hover plates, pressed rows, hairlines |
| ink | `#1a2220` graphite | `#eef3f1` | text |
| ink-2 | `#56605d` | `#a3aeaa` | secondary text |
| ink-3 | `#616b68` | `#8f9b97` | ended and failed codes, chevrons, placeholders |
| input | `#7d8784` | `#6f7b77` | form field borders (3:1 or more on surface and sunk, read-only included) |
| primary | `#0d5c4c` evergreen | `#4fcfa6` | primary actions, the mark, focus |
| on-primary | `#ffffff` | `#05261c` | text on primary |
| live | `#19a67a` | `#4fcfa6` | the "in the meeting" dot only |

Status pills each have a tint and an ink:

| Status | Light | Dark | Dot |
|---|---|---|---|
| In the meeting | `#0a5541` on `#dcf3ea` | `#8bf0cd` on `#133a2f` | live dot with a soft breathing halo |
| Starting, Joining | `#2c4a43` on `#e4ecea` | `#c5d6d0` on `#1e2a27` | dashed ring that slowly turns |
| Check the meeting | `#6e4300` on `#fbecc9` | `#f6c46d` on `#352810` | dot |
| Didn't start | `#9d2117` on `#fbe3df` | `#ffa094` on `#3a1a17` | dot |
| Failed | white on danger `#b42318` | `#1b2421` on `#ff8c7f` | diamond |
| Ended | `#4f5956` on `#e8ebea` | `#a3aeaa` on `#1f2724` | dot |
| Unknown | as Ended | as Ended | ring with "?" |

Measured WCAG contrast: text 6:1 or more on the page and surfaces (ink-3 5.1:1), text on primary 7.9:1 (light) and
8.3:1 (dark), every status pill 6:1 or more, form field borders 3.2:1 or more.

The palette relates to the engine's pages without copying them: dark mode's mint primary echoes the stage's accent
family, and the stage's green and amber become "in the meeting" and "check the meeting".

### Type
**Schibsted Grotesk** (variable, self-hosted), one family. Meeting codes 28px on phones and 34px on desktop, weight
500, tight tracking (-0.03em), tabular figures. Page title 34px / 46px, weight 600. Body 16px (also stops iOS zooming
into inputs). Labels and pills 14px semibold; small text 13–14px. Sentence case everywhere: no all-caps labels.

### Shape, space and depth
- Pills (full radius) for buttons and status; 14px for inputs; 18px for row plates; 24px for the start panel, the
  empty state and dialogs; 28px for the top of bottom sheets.
- A 4px spacing scale. Page gutters 20px on phones, 40px on desktop; content at most 1180px wide.
- **One elevation level,** used only for the start panel, the empty state, sheets and dialogs: a soft, deep shadow
  tinted evergreen in light mode, a darker shadow plus a 1px inner highlight in dark mode. Rows never float.

### Signature details
- **The mark:** an evergreen tile holding a dashed frame behind a solid one, the product's own rule from the stage
  (still being decided, then agreed). It sits next to `PRODUCT_NAME`, needs no letter, and stays the same when the name
  changes. The favicon is the mark.
- **The rule in the list:** sessions still on their way (starting, joining) get a dashed underline under their code
  and a dashed status ring.
- **Texture:** a faint dot grid in the top-left corner of the page that fades out, very low contrast in both modes.

### The sessions list
- Each session is **one tappable row**: the whole row is a link, with hairline separators that start at the text
  edge, a soft plate on hover, a slightly deeper plate and a 1% scale on press, and a chevron that nudges on hover.
- **Hierarchy:** the code first and largest; the status pill next; the platform (icon on desktop) and the time
  quietest. Ended and failed sessions fade their code to ink-3, so active sessions stand out.
- **Phone:** the code on the first line; the pill and "Google Meet, 12 min ago" share the second line and wrap only
  when the text is long.
- **Desktop:** the code and the platform line on the left, the pill aligned to the right edge, then the chevron. The
  list is at most 720px wide. The "Recent" heading shares a baseline with the page title.

### Layout and navigation
- Breakpoints: phone-first from 360px; `md` 768 switches to the desktop layout. No sideways scrolling at any width;
  long values truncate or wrap.
- **This slice has one top-level page,** Sessions; a session's detail is a child of it, and organizations and the
  account live in Clerk's switcher and user menu. A bottom tab bar with one or two tabs would look empty, so there is
  none for now:
  - **Phone:** a top bar (the mark, the org switcher, the account button); the title and a one-line subtitle; the
    list; a full-width "New session" pill in a sticky bottom bar above the safe area, which opens a bottom sheet with
    the start form. On phones under 400px the wordmark hides and the mark carries the brand.
  - **Desktop:** two columns: the title, subtitle and the start panel on the left (sticky), the list on the right.
    Dialogs are centered instead of sheets.
  - **Later:** with three to five top-level pages (library, billing, settings), phones get a bottom tab bar and
    desktop a sidebar.
- One `ResponsiveModal`: a bottom sheet below 768px, a centered dialog from 768px.

### Components
- **Buttons:** primary is an evergreen pill with a fine inner highlight and a soft tinted shadow; secondary is an
  outline pill; quiet (Refresh) is a tinted pill in the primary hue. Disabled is flat (sunk fill, ink-3 text); busy
  keeps full color with a spinner and a busy label ("Starting…"). All press to 98% scale.
- **Inputs:** 52px tall, 14px corners, a link icon, the hint under the label; focus is the primary border with a soft
  ring; errors are a red border with a red-tinted fill and a message with an icon.
- **Empty state:** a surface card with a small dashed-to-solid illustration, "Start your first session", one line of
  explanation, the three real steps (paste the link, admit the bot, watch the prototype take shape) and, on phones,
  the "New session" button. On desktop the start panel beside it is the only call to action.
- **Errors:** a callout with an icon, our text from the plan's error table and its action. The unknown-outcome
  warning is always a persistent amber callout, never only a toast.
- **Toasts** (`sonner`): short, non-critical confirmations only ("Link copied", "Session started"), in a rounded
  graphite (light) or raised (dark) container.
- **Loading:** skeletons shaped like the rows (code, pill, meta), shown after 150 ms.

### Motion
Short and subtle: 150–250 ms, ease-out. Sheets slide up, dialogs fade and scale from 98%, rows and buttons press,
chevrons nudge, the live dot breathes and the joining ring turns. Everything that moves stops under
`prefers-reduced-motion`.

### Feeling like an app on a phone
`viewport-fit=cover` with safe-area insets, `theme-color` for light and dark, touch targets 44px or more (rows 64px
or more), pressed states instead of tap highlights, `touch-action: manipulation`, scroll locked behind sheets, and
`inputmode="url"` on the meeting link. No installable app (PWA) until the name and icons exist.

### Accessibility (WCAG 2.2 AA)
The contrast above; a visible 2px focus ring on every interactive element; real labels with hints and errors linked by
`aria-describedby`; landmarks and headings in order; status never shown by color alone (every pill has a word);
start results in `role="status"`, the warning in `role="alert"`; Radix dialogs and sheets (focus trapped and
restored, Escape closes); nothing depends on hover. Checked by `axe-core` in the tests (jsdom can't compute contrast)
and in a real browser by the screenshot script (contrast included).

### Clerk
`ClerkProvider`'s `appearance.variables` point at the same CSS variables (primary, background, foreground, muted,
input, danger, success, warning, the font and the radius), so sign-in, sign-up, the org switcher and the user menu
follow the theme in light and dark. Clerk's `cssLayerName` puts its styles in a `clerk` layer that `globals.css`
orders before Tailwind's utilities.

### How the look stays consistent
- Screens only compose the components in `src/components/`. A test fails on a raw color outside `globals.css`.
- A dev-only page, `/_design`, shows every component and state and a full app-shell composition in light and dark. It
  isn't in the production build.
- The design foundation (W1b) is approved from `/_design` screenshots before the screen steps start, and each screen
  step is reviewed from screenshots at several widths by a separate review before it's reported done.

## Consequences
- The app has its own look, and accessible behavior for dialogs, sheets and menus comes from Radix.
- We own every component; nothing updates from a registry.
- Markup carries Tailwind class strings; `class-variance-authority` keeps each component's variants in one place.
- All new dependencies arrive in W1's one lockfile change, which redeploys the engine and the api (ADR 0012).
- The palette and the mark are placeholders for a brand that isn't decided; a rebrand edits the tokens, the mark and
  `src/brand.ts`, not the screens.
- Follow-ups: a bottom tab bar and a sidebar once there are three to five top-level pages; an in-app theme toggle if
  a place to store the choice is agreed; a PWA manifest and icons once the name is chosen.
