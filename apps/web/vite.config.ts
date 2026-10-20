// Vite builds the static site; Vitest runs the tests with the same config (ADR 0012).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { cspPlugin } from "./build/csp.ts";

// Tests read dates and money in US English whatever the machine's locale, so they pass the same everywhere. Set here,
// before the test workers start, since a process reads its locale once at startup.
if (process.env.VITEST) {
  process.env.LC_ALL = "en_US.UTF-8";
  process.env.LANG = "en_US.UTF-8";
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
  // Fixed port: the api's CLERK_AUTHORIZED_PARTIES lists this origin for local work, so it must not move.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});
