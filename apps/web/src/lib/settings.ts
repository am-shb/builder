// The rules for the web app's two settings, in one place: the app's config check (src/config.ts) and the build's
// Content Security Policy (build/csp.ts) both use them, so a value the app accepts is always one the policy allows.
// Plain code with no browser or Node imports, so both sides can load it.

// A hostname: labels of letters, digits and hyphens, separated by dots.
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The api's origin from VITE_API_URL: an https URL (or http in development) with no path, query, fragment or
// credentials, returned in its normal form (lower-case host, no default port). Anything else is null. A production build
// refuses plain http, which would send the session token in clear text, except to this computer (a local preview).
export function apiOrigin(apiUrl: string | undefined, { production = false } = {}): string | null {
  const raw = apiUrl?.trim().replace(/\/+$/, "");
  if (!raw || !URL.canParse(raw)) return null;
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || u.pathname !== "/" || u.search || u.hash || raw.includes("?") || raw.includes("#")) return null;
  if (u.protocol === "http:" && production && !LOOPBACK.has(u.hostname)) return null;
  return u.origin;
}

// The Clerk Frontend API host. A publishable key is pk_test_ or pk_live_ followed by the base64 of "<host>$"; a key
// that doesn't decode to a host isn't a publishable key.
export function clerkFrontendApiHost(publishableKey: string | undefined): string | null {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey?.trim() ?? "");
  if (!m) return null;
  let decoded: string;
  try {
    decoded = atob(m[2]!);
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return HOSTNAME.test(host) ? host.toLowerCase() : null;
}
