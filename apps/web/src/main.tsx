// Picks what to load before loading it (ADR 0017): a landing page for signed-out visitors, or the app. Each is its own
// chunk, so a visitor never downloads the app and a member never downloads the landing page.
import "./styles/globals.css";
import { initColorMode } from "./lib/color-mode.ts";
import { probablySignedIn } from "./lib/signed-in-hint.ts";
import { isLandingPath, normalPath } from "./landing/paths.ts";

initColorMode();

const path = normalPath(location.pathname);
const root = document.getElementById("root");
if (root) {
  // `/` is the sessions page for a member, so a browser that is probably signed in loads the app there.
  const landing = isLandingPath(path) && !(path === "/" && probablySignedIn());
  const start = landing
    ? import("./landing/entry.tsx").then((m) => m.mountLanding(root, path))
    : import("./app-entry.tsx").then((m) => m.mountApp(root, path));
  // A chunk that fails to download (a new deploy, a dropped connection) leaves a message, never a blank page.
  start.catch(() => {
    root.textContent = "This page didn't load. Reload to try again.";
  });
}
