// Verifies webhook / websocket-upgrade requests signed by Recall with the
// workspace verification secret (webhook-id / webhook-timestamp / webhook-signature).
import crypto from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export function verifyRequestFromRecall(args: {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  payload: string | null;
  nowSeconds?: number;
}): void {
  const { secret, headers, payload } = args;
  const h = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v.join(",") : v;
  };
  const msgId = h("webhook-id") ?? h("svix-id");
  const msgTimestamp = h("webhook-timestamp") ?? h("svix-timestamp");
  const msgSignature = h("webhook-signature") ?? h("svix-signature");

  if (!secret.startsWith("whsec_")) throw new Error("verification secret is invalid");
  if (!msgId || !msgTimestamp || !msgSignature) throw new Error("missing signature headers");

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(msgTimestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) {
    throw new Error("timestamp outside tolerance");
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${msgId}.${msgTimestamp}.${payload ?? ""}`)
    .digest();

  for (const versioned of msgSignature.split(" ")) {
    const [version, signature] = versioned.split(",");
    if (version !== "v1" || !signature) continue;
    const given = Buffer.from(signature, "base64");
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return;
  }
  throw new Error("no matching signature");
}

// Test/fixture helper: produces headers exactly as Recall would.
export function signForTest(secret: string, payload: string, id = "msg_test", ts = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` };
}
