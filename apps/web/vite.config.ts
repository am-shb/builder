// Vite builds the static site; Vitest runs the tests with the same config (ADR 0012).
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { cspPlugin } from "./build/csp.ts";

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
