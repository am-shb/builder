// Backend-only configuration boundary. Reads named Recall settings from the
// runtime environment; never logs values.
import { randomBytes } from "node:crypto";

export type Config = {
  region: string;
  apiKey: string;
  verificationSecret: string;
  publicBaseUrl: string;
  port: number;
  // Postgres connection string (Render). Null = PGlite in this process, kept in `pgliteDir`.
  databaseUrl: string | null;
  pgliteDir: string;
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
};

const REGIONS = new Set(["us-west-2", "us-east-1", "eu-central-1", "ap-northeast-1"]);

export function loadConfig(env: Record<string, string | undefined>): Config {
  const required = [
    "RECALL_REGION",
    "RECALL_API_KEY",
    "RECALL_WEBHOOK_VERIFICATION_SECRET",
    "PUBLIC_API_BASE_URL",
  ] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const region = env.RECALL_REGION!.trim();
  if (!REGIONS.has(region)) throw new Error(`RECALL_REGION is not a known Recall region`);

  const verificationSecret = env.RECALL_WEBHOOK_VERIFICATION_SECRET!.trim();
  if (!verificationSecret.startsWith("whsec_")) {
    throw new Error("RECALL_WEBHOOK_VERIFICATION_SECRET must start with whsec_");
  }

  const publicBaseUrl = env.PUBLIC_API_BASE_URL!.trim().replace(/\/+$/, "");
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
    databaseUrl: env.DATABASE_URL?.trim() || null,
    pgliteDir: env.PGLITE_DIR?.trim() || "data/pg",
    botVariant,
    ...agentSettings(env),
    local: false,
  };
}

/**
 * Local mode: no Recall setting is read or needed. The stage is served from localhost, the
 * realtime webhook accepts nothing (its secret is random and never shared), and sessions go in
 * their own database so they don't mix with real calls: always PGlite, even when DATABASE_URL is set.
 */
export function loadLocalConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env.PORT ?? 3000);
  return {
    region: "local",
    apiKey: "",
    verificationSecret: "whsec_" + randomBytes(24).toString("base64"),
    publicBaseUrl: `http://localhost:${port}`,
    port,
    databaseUrl: null,
    pgliteDir: env.PGLITE_DIR?.trim() || "data/local-pg",
    botVariant: null,
    ...agentSettings(env),
    local: true,
  };
}

function agentSettings(env: Record<string, string | undefined>) {
  const openrouterApiKey = env.OPENROUTER_API_KEY?.trim() || null;
  return { openrouterApiKey, agentEnabled: !!openrouterApiKey, ttsVoice: env.TTS_VOICE?.trim() || null };
}
