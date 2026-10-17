// Backend-only configuration boundary. Reads named Recall settings from the
// runtime environment; never logs values.

export type Config = {
  region: string;
  apiKey: string;
  verificationSecret: string;
  publicBaseUrl: string;
  port: number;
  dbPath: string;
  // Optional larger bot for smoother Output Media (costs more per hour).
  botVariant: "web_4_core" | "web_gpu" | null;
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

  const botVariant = env.BOT_VARIANT?.trim() || null;
  if (botVariant && botVariant !== "web_4_core" && botVariant !== "web_gpu") {
    throw new Error("BOT_VARIANT must be web_4_core, web_gpu, or empty");
  }

  return {
    region,
    apiKey: env.RECALL_API_KEY!.trim(),
    verificationSecret,
    publicBaseUrl,
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? "data/app.db",
    botVariant: botVariant as Config["botVariant"],
  };
}
