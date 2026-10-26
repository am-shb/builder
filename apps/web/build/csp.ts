// The Content Security Policy that names our origins (ADR 0012). Render's header values are literal text, so a
// policy naming the api and the Clerk instance can't live in render.yaml without writing URLs into the repo. Instead
// this plugin writes it into index.html at build time, as the first tag in <head>, from the two VITE_* variables.
// Render sends the rest as headers, set on builder-web in render.yaml: frame-ancestors (which a <meta> policy can't
// carry), X-Frame-Options, Referrer-Policy, nosniff, Permissions-Policy and Cross-Origin-Opener-Policy.
import { loadEnv, type Plugin } from "vite";
import { apiOrigin, clerkFrontendApiHost } from "@builder/session-core";

export type CspInput = {
  apiUrl?: string | undefined;
  publishableKey?: string | undefined;
  // A production build: plain http to the api is refused (src/lib/settings.ts).
  production?: boolean;
};

// The rules for both values live in src/lib/settings.ts, shared with the app's own config check.
export { apiOrigin, clerkFrontendApiHost };

// The policy. With either value missing or invalid, its origin is left out and the rest stays as strict.
export function buildCsp(input: CspInput): string {
  const api = apiOrigin(input.apiUrl, { production: input.production ?? false });
  const fapi = clerkFrontendApiHost(input.publishableKey);
  const clerk = fapi ? [`https://${fapi}`] : [];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...clerk, "https://challenges.cloudflare.com", "https://*.protect.clerk.com"]],
    ["connect-src", ["'self'", ...(api ? [api] : []), ...clerk, "https://*.protect.clerk.com:*"]],
    // data: for the small SVG images Clerk's components draw (found by the production-build check, M7).
    ["img-src", ["'self'", "https://img.clerk.com", "data:"]],
    // Clerk's components inject their styles at runtime.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["worker-src", ["'self'", "blob:"]],
    // The landing page's demo video.
    ["frame-src", ["https://challenges.cloudflare.com", "https://*.protect.clerk.com", "https://www.youtube-nocookie.com"]],
    ["form-action", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

// Build only: Vite's dev server needs inline scripts and its own websocket, so `vite dev` gets no policy.
export function cspPlugin(): Plugin {
  let input: CspInput = {};
  return {
    name: "builder-csp",
    apply: "build",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || config.root, "VITE_");
      input = { apiUrl: env.VITE_API_URL, publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY, production: config.isProduction };
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return injectCsp(html, buildCsp(input));
      },
    },
  };
}

// Puts the policy right after <meta charset>, so the charset stays first and the policy comes before every script
// and stylesheet. Fails the build if index.html has no charset tag, rather than shipping a page without a policy.
export function injectCsp(html: string, policy: string): string {
  const charset = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i.exec(html);
  if (!charset) throw new Error("index.html needs <meta charset=\"UTF-8\" /> for the CSP to go after it");
  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(policy)}" />`;
  const end = charset.index + charset[0].length;
  return `${html.slice(0, end)}\n    ${tag}${html.slice(end)}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
