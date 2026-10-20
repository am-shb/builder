// The Content Security Policy that names our origins (ADR 0012). Render's header values are literal text, so a
// policy naming the api and the Clerk instance can't live in render.yaml without writing URLs into the repo. Instead
// this plugin writes it into index.html at build time, as the first tag in <head>, from the two VITE_* variables.
// Render sends the rest as headers (frame-ancestors, which a <meta> policy can't carry, and the others).
import { loadEnv, type Plugin } from "vite";

export type CspInput = {
  apiUrl?: string | undefined;
  publishableKey?: string | undefined;
};

// A hostname: labels of letters, digits and hyphens, separated by dots.
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// The api's origin from VITE_API_URL: an http or https URL with no path, query or credentials. Anything else is null,
// so a bad value leaves the api out of the policy instead of widening it.
export function apiOrigin(apiUrl: string | undefined): string | null {
  const raw = apiUrl?.trim().replace(/\/+$/, "");
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.origin !== raw) return null;
  return u.origin;
}

// The Clerk Frontend API host. A publishable key is pk_test_ or pk_live_ followed by the base64 of "<host>$".
export function clerkFrontendApiHost(publishableKey: string | undefined): string | null {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey?.trim() ?? "");
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[2]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return HOSTNAME.test(host) ? host.toLowerCase() : null;
}

// The policy. With either value missing or invalid, its origin is left out and the rest stays as strict.
export function buildCsp(input: CspInput): string {
  const api = apiOrigin(input.apiUrl);
  const fapi = clerkFrontendApiHost(input.publishableKey);
  const clerk = fapi ? [`https://${fapi}`] : [];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...clerk, "https://challenges.cloudflare.com", "https://*.protect.clerk.com"]],
    ["connect-src", ["'self'", ...(api ? [api] : []), ...clerk, "https://*.protect.clerk.com:*"]],
    ["img-src", ["'self'", "https://img.clerk.com"]],
    // Clerk's components inject their styles at runtime.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", ["https://challenges.cloudflare.com", "https://*.protect.clerk.com"]],
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
      input = { apiUrl: env.VITE_API_URL, publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY };
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
