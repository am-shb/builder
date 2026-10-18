// Clerk-shaped session tokens signed with a key pair made when the tests start. The real `verifyToken` checks
// them against the public key offline, so no test ever talks to Clerk.
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { ClerkConfig } from "../../src/config.ts";

const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const { publicKey, privateKey } = pair();
const pem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString().trim();

export const WEB_ORIGIN = "http://localhost:5173";
export const testClerk: ClerkConfig = { jwtKey: pem(publicKey), authorizedParties: [WEB_ORIGIN] };

/** A second key pair, for "signed by someone else" cases. */
export const otherPrivateKey = pair().privateKey;

const b64url = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

export function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: KeyObject = privateKey): string {
  const body = `${b64url(header)}.${b64url(payload)}`;
  const alg = header.alg;
  let sig: string;
  if (alg === "none") sig = "";
  else if (alg === "HS256") sig = createHmac("sha256", "guessable-shared-secret").update(body).digest("base64url");
  else sig = createSign("RSA-SHA256").update(body).sign(key).toString("base64url");
  return `${body}.${sig}`;
}

export type TokenOptions = {
  userId?: string;
  orgId?: string | null;
  // Without the `org:` prefix, as Clerk's v2 `o.rol` carries it.
  rol?: string;
  azp?: string | null;
  // Seconds from now. Negative means expired.
  expiresIn?: number;
  notBeforeIn?: number;
  sts?: string;
  key?: KeyObject;
  extra?: Record<string, unknown>;
};

/** A v2 session token as Clerk mints it, with the active org in `o`. */
export function signToken(opts: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const orgId = opts.orgId === undefined ? "org_test_a" : opts.orgId;
  const payload: Record<string, unknown> = {
    v: 2,
    sub: opts.userId ?? "user_test_1",
    sid: "sess_test_1",
    iss: "https://test.clerk.accounts.dev",
    iat: now - 5,
    nbf: now - 5 + (opts.notBeforeIn ?? 0),
    exp: now + (opts.expiresIn ?? 60),
    sts: opts.sts ?? "active",
    ...(opts.azp === null ? {} : { azp: opts.azp ?? WEB_ORIGIN }),
    ...(orgId ? { o: { id: orgId, rol: opts.rol ?? "member", slg: "test-org" } } : {}),
    ...opts.extra,
  };
  return signJwt({ alg: "RS256", typ: "JWT", kid: "ins_test" }, payload, opts.key);
}
