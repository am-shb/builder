// Backend-only configuration boundary. Reads named Recall settings from the
// runtime environment; never logs values.
import { randomBytes } from "node:crypto";

export type Config = {
  region: string;
  apiKey: string;
  verificationSecret: string;
  publicBaseUrl: string;
  port: number;
  // SurrealDB (docs/adr/0011-surrealdb.md). A server URL (SurrealDB Cloud, wss://) with its credentials, or null
  // for SurrealDB in this process, kept in the SurrealKV folder `surreal.path`.
  surreal: SurrealSettings;
  // Larger bot for smoother Output Media (costs more per hour); null = plain web bot.
  botVariant: "web_4_core" | "web_gpu" | null;
  // OpenRouter key for all model access (LLM + TTS). Absent = listen-only.
  openrouterApiKey: string | null;
  agentEnabled: boolean;
  // ElevenLabs voice for elevenlabs/eleven-v4-turbo, e.g. "george" (test/fixtures/openrouter-tts.md).
  // Absent = Builder's lines go to meeting chat.
  ttsVoice: string | null;
  // Local mode (`npm run local`): no Recall. Transcript comes from the operator's own mic on /local.
  local: boolean;
  // Shared bearer token for /internal/* (ADR 0008), the same value as the api's ENGINE_INTERNAL_TOKEN. null: the
  // internal routes are off and answer 404.
  internalToken: string | null;
  // The api's private origin for session status events (A2, ADR 0008), e.g. http://builder-api:10000. null: no events
  // are sent, and the api's statuses stay at what the start answered (its stale-session margin still applies).
  apiInternalUrl: string | null;
};

const REGIONS = new Set(["us-west-2", "us-east-1", "eu-central-1", "ap-northeast-1"]);

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Render sets RENDER_EXTERNAL_URL on web services, so PUBLIC_API_BASE_URL needs no manual step there.
  const publicUrl = env.PUBLIC_API_BASE_URL?.trim() || env.RENDER_EXTERNAL_URL?.trim() || "";
  const required = ["RECALL_REGION", "RECALL_API_KEY", "RECALL_WEBHOOK_VERIFICATION_SECRET"] as const;
  const missing: string[] = required.filter((name) => !env[name]?.trim());
  if (!publicUrl) missing.push("PUBLIC_API_BASE_URL");
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const region = env.RECALL_REGION!.trim();
  if (!REGIONS.has(region)) throw new Error(`RECALL_REGION is not a known Recall region`);

  const verificationSecret = env.RECALL_WEBHOOK_VERIFICATION_SECRET!.trim();
  if (!verificationSecret.startsWith("whsec_")) {
    throw new Error("RECALL_WEBHOOK_VERIFICATION_SECRET must start with whsec_");
  }

  const publicBaseUrl = publicUrl.replace(/\/+$/, "");
  const url = new URL(publicBaseUrl);
  if (url.protocol !== "https:") throw new Error("PUBLIC_API_BASE_URL must be https");
  if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(url.hostname)) {
    throw new Error("PUBLIC_API_BASE_URL must be publicly reachable, not localhost/private");
  }

  // Default is the 4-core bot; BOT_VARIANT=web opts into Recall's plain web bot.
  const rawVariant = env.BOT_VARIANT?.trim() || "web_4_core";
  if (rawVariant !== "web_4_core" && rawVariant !== "web_gpu" && rawVariant !== "web") {
    throw new Error("BOT_VARIANT must be web_4_core, web_gpu, web, or empty");
  }
  const botVariant = rawVariant === "web" ? null : rawVariant;

  return {
    region,
    apiKey: env.RECALL_API_KEY!.trim(),
    verificationSecret,
    publicBaseUrl,
    port: Number(env.PORT ?? 3000),
    surreal: surrealSettings(env),
    botVariant,
    ...agentSettings(env),
    local: false,
    ...internalSettings(env),
  };
}

/**
 * Local mode: no Recall setting is read or needed. The stage is served from localhost, the
 * realtime webhook accepts nothing (its secret is random and never shared), and sessions go in
 * their own database so they don't mix with real calls: always SurrealDB in this process, in its own folder,
 * even when SURREAL_URL is set.
 */
export function loadLocalConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env.PORT ?? 3000);
  return {
    region: "local",
    apiKey: "",
    verificationSecret: "whsec_" + randomBytes(24).toString("base64"),
    publicBaseUrl: `http://localhost:${port}`,
    port,
    surreal: { url: null, user: null, pass: null, auth: "database", path: env.SURREAL_PATH?.trim() || "data/local-surreal" },
    botVariant: null,
    ...agentSettings(env),
    local: true,
    ...internalSettings(env),
  };
}

export type SurrealSettings = {
  url: string | null;
  user: string | null;
  pass: string | null;
  auth: "database" | "root";
  path: string;
};

/**
 * SURREAL_URL set: that server, signed in as SURREAL_USER with SURREAL_PASS. SURREAL_AUTH says what kind of user:
 * `database` (the default) is a user defined on namespace builder, database engine, which is how SurrealDB Cloud is
 * set up; `root` is a root user, as on a local `surreal start`. Unset: SurrealDB in this process, in SURREAL_PATH.
 */
export function surrealSettings(env: Record<string, string | undefined>): SurrealSettings {
  const url = env.SURREAL_URL?.trim() || null;
  const auth = env.SURREAL_AUTH?.trim() || "database";
  if (auth !== "database" && auth !== "root") throw new Error("SURREAL_AUTH must be database, root, or empty");
  const user = env.SURREAL_USER?.trim() || null;
  const pass = env.SURREAL_PASS || null;
  if (url) {
    const protocol = URL.canParse(url) ? new URL(url).protocol : "";
    if (protocol !== "ws:" && protocol !== "wss:") throw new Error("SURREAL_URL must be a ws:// or wss:// URL");
    if (!user || !pass) throw new Error("SURREAL_USER and SURREAL_PASS are required with SURREAL_URL");
  }
  return { url, user, pass, auth, path: env.SURREAL_PATH?.trim() || "data/surreal" };
}

const MIN_INTERNAL_TOKEN_LENGTH = 32;

/**
 * API_INTERNAL_URL: where the engine sends session status events. An http or https origin with no path, or Render's
 * `host:port` (fromService hostport), which means http on the private network. It needs ENGINE_INTERNAL_TOKEN, the
 * bearer token for both directions. Errors never quote the value.
 */
export function apiInternalUrl(env: Record<string, string | undefined>, token: string | null): string | null {
  const raw = env.API_INTERNAL_URL?.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const bad = () => new Error("API_INTERNAL_URL must be an http or https origin with no path, or host:port");
  if (!URL.canParse(withScheme)) throw bad();
  const u = new URL(withScheme);
  const extra = u.pathname !== "/" || u.search || u.hash || /[?#]/.test(withScheme);
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || extra) throw bad();
  if (!token) throw new Error("API_INTERNAL_URL needs ENGINE_INTERNAL_TOKEN, the token the api checks");
  return u.origin;
}

/** The token for /internal/* and the api's address for events, read together. */
export function internalSettings(env: Record<string, string | undefined>): { internalToken: string | null; apiInternalUrl: string | null } {
  const token = internalToken(env);
  return { internalToken: token, apiInternalUrl: apiInternalUrl(env, token) };
}

/** ENGINE_INTERNAL_TOKEN: unset turns /internal/* off. Set, it must be long enough to guess at; the error never quotes it. */
export function internalToken(env: Record<string, string | undefined>): string | null {
  const token = env.ENGINE_INTERNAL_TOKEN?.trim() || null;
  if (token && token.length < MIN_INTERNAL_TOKEN_LENGTH) {
    throw new Error(`ENGINE_INTERNAL_TOKEN must be at least ${MIN_INTERNAL_TOKEN_LENGTH} characters`);
  }
  return token;
}

function agentSettings(env: Record<string, string | undefined>) {
  const openrouterApiKey = env.OPENROUTER_API_KEY?.trim() || null;
  return { openrouterApiKey, agentEnabled: !!openrouterApiKey, ttsVoice: env.TTS_VOICE?.trim() || null };
}
