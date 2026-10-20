// First, before anything that uses zod.
import "./lib/zod-setup.ts";
import "./styles/globals.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { PRODUCT_NAME } from "./brand.ts";
import { initColorMode } from "./lib/color-mode.ts";

document.title = PRODUCT_NAME;
initColorMode();

// /_design shows the design system, in the dev server only. In a production build `import.meta.env.DEV` is false, so
// this branch and the page's code are left out (scripts/check-dist.ts checks that).
const DesignPage = import.meta.env.DEV && location.pathname.replace(/\/+$/, "") === "/_design"
  ? lazy(() => import("./design/DesignPage.tsx"))
  : null;

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {DesignPage ? <Suspense fallback={null}><DesignPage /></Suspense> : <App />}
    </StrictMode>,
  );
}
