# 0017: A public landing page at `/`, loaded as its own chunk

- **Status:** proposed
- **Date:** 2026-10-23
- **Area:** web (`apps/web`)

## Context
The web app has no public page. A signed-out visitor at `/` is sent to `/sign-in` (ADR 0012), so there is nothing to
show at the hackathon, to investors, or to someone following a shared link. ADR 0012 says the app "needs no SEO",
which was true while every page sat behind sign-in.

A landing page changes three things the app relied on:
- Every page waits for Clerk's script before it renders (`<ClerkLoading>`). A landing page that waits for an auth
  script from another origin would be slow on a phone, and its first paint would be a spinner.
- The landing page and the app would ship as one bundle, so visitors would download the app and members the page.
- The page needs a title, a description and a share image that crawlers and chat apps can read without JavaScript.

## Options considered
1. **A separate static site** (another Render service, plain HTML). Fast and simple, but a second deploy, a second
   CSP, and the design tokens, fonts and color mode copied rather than shared.
2. **A route inside the app, behind Clerk.** No new structure, but the page waits for Clerk and carries the app.
3. **One site, two entry chunks, picked before anything loads.** `main.tsx` looks at the path and a sign-in hint and
   imports either the landing chunk or the app chunk. Both share the tokens, fonts, color mode and components.

## Decision
Option 3.
- **Paths.** `/`, `/privacy` and `/terms` are landing pages. Everything else is the app, as before.
- **The hint.** At `/`, `src/lib/signed-in-hint.ts` reads Clerk's `__client_uat` cookie (its name may carry a suffix),
  which Clerk keeps at `0` when signed out and at a timestamp when signed in. A timestamp loads the app, so a member
  goes straight to their sessions. Anything else loads the landing page. The cookie is only read, never written, and it
  only picks which chunk to load: Clerk still decides who is signed in. If the hint is wrong (a stale cookie), the app
  loads, Clerk reports signed out, and `RequireOrg` shows the landing page at `/` instead of redirecting to sign-in.
- **Links.** "Start free" goes to `/sign-up` and "Sign in" to `/sign-in` as plain links, which load the app chunk.
- **Bundles.** The landing chunk doesn't import Clerk, the router, the api client or zod. `scripts/check-dist.ts`
  checks that the chunks it loads contain neither Clerk nor zod. To keep zod out, `@builder/session-core` gets a
  second, additive entry, `@builder/session-core/brand`, holding only the product's names; `apps/web/src/brand.ts`
  imports from it.
- **SEO and sharing.** This supersedes ADR 0012's "needs no SEO" for the landing paths only. `index.html` carries a
  title, a description, Open Graph and Twitter tags, written at build time from `PRODUCT_NAME` by a Vite plugin. The
  share image is `public/og.png`, made by `scripts/share-images.ts` with the local Chrome and committed. Its URL is made
  absolute when the build knows the site's origin (`SITE_URL`, else Render's `RENDER_EXTERNAL_URL`), and is relative
  otherwise. `robots.txt` allows the landing paths and asks crawlers to skip the app's.
- **Design.** The landing page uses the Boardroom tokens, fonts and color mode (ADR 0015), with larger type and more
  motion. Motion is CSS and a few small hooks, with no animation library. Everything that moves stops under
  `prefers-reduced-motion`, and the hero animation pauses when it is off screen. Motion that runs longer than five
  seconds can be stopped (WCAG 2.2.2): the hero's loop has a Pause button, and the features' small visuals play once
  and rest. New colors are tokens in
  `globals.css`, like every other color.
- **Packages.** One new: `@fontsource-variable/fraunces`, the display font for large headings (ADR 0015). The phone
  menu and the FAQ use the Radix primitives already installed, and the motion needs no library.
- **CSP.** Unchanged. Images, fonts and the demo video (added later as `public/demo.mp4`) come from our own origin.

## Consequences
- Signed-out visitors get a fast first paint with no auth script. Members still land on their sessions.
- `guards.test.ts` allows `signed-in-hint.ts` to read `document.cookie`, and only to read it.
- The existing test "signed out on the home page goes to plain /sign-in" changes: signed out at `/` shows the
  landing page. Signed out on any other member page still goes to sign-in.
- The landing copy may only describe what the code does (AGENTS.md). Pricing follows ADR 0009, with no prices until
  billing exists.
- When the product name is decided, the page, the tags and the share image follow `PRODUCT_NAME`. The share image and
  the home-screen icon have to be made again: `npm run share-images -w @builder/web`.
- `npm run landing-layout -w @builder/web` checks the page in Chrome at 360 to 2560px and at 125% and 150% zoom: no
  sideways scrolling, no two texts overlapping, nothing off screen, and the hero's headline within its column on at
  most three lines. `npm run screenshots -w @builder/web -- landing` takes the page at six widths in both modes and runs
  axe with color contrast.
- The words live in `src/landing/copy.ts`. There is no contact address yet, so the page has no email links: every plan's
  button goes to sign-up, which starts on Free. The demo video goes in `public/` and is named by `DEMO_VIDEO`.
- `/privacy` and `/terms` are placeholders that say only what is true today. They must be replaced before launch.
