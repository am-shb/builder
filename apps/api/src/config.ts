// Reads the api's settings from the environment once, at start (docs/adr/0010-api-stack.md).
// Errors name the variable, never its value. Optional parts are null when their variables are unset; the routes
// that need them answer 503 instead of the process refusing to start.
import type { SessionLimits } from "@builder/contracts";
import { DEFAULT_START_GUARDS, type StartGuards } from "./start-guards.ts";

export type ClerkConfig = {
  // Clerk's PEM public key: tokens are checked offline, with no call to Clerk.
  jwtKey: string;
  // The web app's origins. A token minted for any other site is refused.
  authorizedParties: string[];
};

export type EngineConfig = {
  // The engine's private-network origin, e.g. http://builder-engine:10000 on Render. ENGINE_INTERNAL_URL may also be
  // a bare host:port, which means http.
  url: string;
  // Shared bearer token for /internal/* (ADR 0008).
  token: string;
};

export type Config = {
  port: number;
  clerk: ClerkConfig | null;
  engine: EngineConfig | null;
  // Per-session limits until billing exists (decision D5 in docs/plans/api-first-slice.md).
  defaultLimits: SessionLimits | null;
  // Limits on starting sessions (src/start-guards.ts). Always set: each falls back to its default.
  startGuards: StartGuards;
  // SurrealDB (docs/adr/0011-surrealdb.md): a server with its credentials, or SurrealDB in this process.
  surreal: SurrealSettings;
};

export type SurrealSettings = {
  // ws:// or wss:// (SurrealDB Cloud in production). null: SurrealDB in this process, in `path`.
  url: string | null;
  user: string | null;
  pass: string | null;
  auth: "database" | "root";
  path: string;
};

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

const MIN_TOKEN_LENGTH = 32;

export function loadConfig(env: Env): Config {
  return {
    port: readPort(env),
    clerk: readClerk(env),
    engine: readEngine(env),
    defaultLimits: readLimits(env),
    startGuards: readStartGuards(env),
    surreal: surrealSettings(env),
  };
}

/**
 * The engine's SURREAL_* rules (apps/engine/src/config.ts), plus one: production needs a server.
 * - SURREAL_URL set: that server, signed in as SURREAL_USER with SURREAL_PASS. SURREAL_AUTH says what kind of user:
 *   `database` (the default) is a user defined on namespace builder, database api, as on SurrealDB Cloud; `root` is a
 *   root user, as on a local `surreal start`.
 * - Unset: SurrealDB in this process, in SURREAL_PATH (default data/surreal). Refused when NODE_ENV=production, where
 *   that folder would vanish on the next deploy.
 */
export function surrealSettings(env: Env): SurrealSettings {
  const url = value(env, "SURREAL_URL") ?? null;
  const auth = value(env, "SURREAL_AUTH") ?? "database";
  if (auth !== "database" && auth !== "root") throw new ConfigError("SURREAL_AUTH must be database, root, or empty");
  const user = value(env, "SURREAL_USER") ?? null;
  // Not trimmed: a password may have spaces.
  const pass = env.SURREAL_PASS || null;
  if (url) {
    const protocol = URL.canParse(url) ? new URL(url).protocol : "";
    if (protocol !== "ws:" && protocol !== "wss:") throw new ConfigError("SURREAL_URL must be a ws:// or wss:// URL");
    if (!user || !pass) throw new ConfigError("SURREAL_USER and SURREAL_PASS are required with SURREAL_URL");
  } else if (value(env, "NODE_ENV") === "production") {
    throw new ConfigError("SURREAL_URL is required when NODE_ENV=production");
  }
  return { url, user, pass, auth, path: value(env, "SURREAL_PATH") ?? "data/surreal" };
}

const value = (env: Env, name: string) => env[name]?.trim() || undefined;

// Variables that only make sense together: all set, or none.
function together(env: Env, names: string[]): Record<string, string> | null {
  const set = names.filter((n) => value(env, n) !== undefined);
  if (set.length === 0) return null;
  const missing = names.filter((n) => value(env, n) === undefined);
  if (missing.length) throw new ConfigError(`${missing.join(", ")} must be set together with ${set.join(", ")}`);
  return Object.fromEntries(names.map((n) => [n, value(env, n)!]));
}

function readPort(env: Env): number {
  const raw = value(env, "PORT");
  if (raw === undefined) return 3001;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError("PORT must be a whole number from 1 to 65535");
  return port;
}

function readClerk(env: Env): ClerkConfig | null {
  const v = together(env, ["CLERK_JWT_KEY", "CLERK_AUTHORIZED_PARTIES"]);
  if (!v) return null;
  // Dashboards often keep a PEM on one line with literal "\n"s.
  const jwtKey = v.CLERK_JWT_KEY.replace(/\\n/g, "\n");
  if (!/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----$/.test(jwtKey)) {
    throw new ConfigError("CLERK_JWT_KEY must be a PEM public key (-----BEGIN PUBLIC KEY----- ...)");
  }
  const authorizedParties = v.CLERK_AUTHORIZED_PARTIES.split(",").map((s) => s.trim()).filter(Boolean);
  if (!authorizedParties.length || !authorizedParties.every(isOrigin)) {
    throw new ConfigError("CLERK_AUTHORIZED_PARTIES must be comma-separated origins, such as https://app.example.com");
  }
  return { jwtKey, authorizedParties };
}

const HOST_PORT = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?:\d{1,5}$/i;

function readEngine(env: Env): EngineConfig | null {
  const v = together(env, ["ENGINE_INTERNAL_URL", "ENGINE_INTERNAL_TOKEN"]);
  if (!v) return null;
  // A bare host:port, as Render's `fromService` `hostport` gives it (builder-engine:10000), is reached over plain
  // http on the private network.
  const raw = v.ENGINE_INTERNAL_URL.replace(/\/+$/, "");
  const url = HOST_PORT.test(raw) ? `http://${raw}` : raw;
  if (!isOrigin(url)) throw new ConfigError("ENGINE_INTERNAL_URL must be an http or https origin, with no path");
  if (v.ENGINE_INTERNAL_TOKEN.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(`ENGINE_INTERNAL_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return { url, token: v.ENGINE_INTERNAL_TOKEN };
}

function readLimits(env: Env): SessionLimits | null {
  const v = together(env, ["DEFAULT_MAX_USD", "DEFAULT_MAX_MINUTES"]);
  if (!v) return null;
  const maxUsd = Number(v.DEFAULT_MAX_USD);
  const maxMinutes = Number(v.DEFAULT_MAX_MINUTES);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new ConfigError("DEFAULT_MAX_USD must be a number above 0");
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) throw new ConfigError("DEFAULT_MAX_MINUTES must be a number above 0");
  return { maxUsd, maxMinutes };
}

function readStartGuards(env: Env): StartGuards {
  // A whole number, at least `min`; unset means the default.
  const count = (name: string, fallback: number, min: number) => {
    const raw = value(env, name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new ConfigError(`${name} must be a whole number of at least ${min}`);
    return n;
  };
  const d = DEFAULT_START_GUARDS;
  return {
    maxActivePerOrg: count("MAX_ACTIVE_SESSIONS_PER_ORG", d.maxActivePerOrg, 1),
    maxStartsPerOrgPerDay: count("MAX_STARTS_PER_ORG_PER_DAY", d.maxStartsPerOrgPerDay, 1),
    startsPerUserPerMinute: count("START_RATE_LIMIT_PER_MINUTE", d.startsPerUserPerMinute, 1),
    activeMarginMinutes: count("ACTIVE_MARGIN_MINUTES", d.activeMarginMinutes, 0),
  };
}

function isOrigin(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === s;
  } catch {
    return false;
  }
}
