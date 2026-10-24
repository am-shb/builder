// The app's entry: sign-in, sign-up and the member pages, behind Clerk (ADR 0012). main.tsx loads it for every path
// that isn't a landing page, and for `/` when the browser is probably signed in (ADR 0017).
// First, before anything that uses zod.
import "./lib/zod-setup.ts";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { PRODUCT_NAME } from "./brand.ts";

export function mountApp(root: HTMLElement, path: string) {
  document.title = PRODUCT_NAME;
  // /_design shows the design system, in the dev server only. In a production build `import.meta.env.DEV` is false,
  // so this branch and the page's code are left out (scripts/check-dist.ts checks that).
  const DesignPage = import.meta.env.DEV && path === "/_design" ? lazy(() => import("./design/DesignPage.tsx")) : null;
  createRoot(root).render(
    <StrictMode>
      {DesignPage ? <Suspense fallback={null}><DesignPage /></Suspense> : <App />}
    </StrictMode>,
  );
}
