// Checks Clerk session tokens offline (ADR 0006, ADR 0010). `verifyToken` with `jwtKey` checks the signature
// (RS256/384/512 only), `exp`, `nbf`, `iat` and `azp` against our origins, and never calls Clerk.
// Never log a token or a verification message: messages quote claims from the token. Log the reason code only.
import type { IncomingMessage } from "node:http";
import { verifyToken } from "@clerk/backend";
import { decodeJwt } from "@clerk/backend/jwt";
import type { ClerkConfig } from "../config.ts";
import { HttpError } from "../http.ts";
import type { Log } from "../router.ts";

/** Who is calling. `orgId` and `orgRole` are null when the session has no active org. */
export type Caller = {
  userId: string;
  sessionId: string | null;
  orgId: string | null;
  // Clerk's role key, with the `org:` prefix: "org:admin", "org:member", or a custom role.
  orgRole: string | null;
};

export type Authenticator = { authenticate(req: IncomingMessage): Promise<Caller> };

export type VerifyToken = typeof verifyToken;

const unauthenticated = () => new HttpError(401, "unauthenticated", "Sign in again: the session token is missing or not valid.");

/** `Authorization: Bearer <token>`, or null. The scheme is case-insensitive. */
export function bearerToken(req: IncomingMessage): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "");
  return m ? m[1] : null;
}

/**
 * Reads the caller from verified claims, the same way Clerk's SDK does: session token v2 keeps the org in `o`
 * (`id`, and `rol` without the `org:` prefix); v1 used `org_id` and `org_role`.
 */
export function callerFromClaims(claims: Record<string, unknown>): Caller | null {
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const userId = str(claims.sub);
  if (!userId) return null;
  let orgId: string | null;
  let orgRole: string | null;
  if (claims.v === 2) {
    const o = claims.o && typeof claims.o === "object" ? (claims.o as Record<string, unknown>) : {};
    orgId = str(o.id);
    const rol = str(o.rol);
    orgRole = rol ? `org:${rol}` : null;
  } else {
    orgId = str(claims.org_id);
    orgRole = str(claims.org_role);
  }
  if (!orgId) orgRole = null;
  return { userId, sessionId: str(claims.sid), orgId, orgRole };
}

/**
 * Whether the token names the site it was minted for. A browser's token carries its origin in `azp`; a native app's
 * token (Expo, through Clerk's Native API) has no origin and no `azp` at all. Read without verifying, only to choose
 * the check: the signature and the times are verified right after. A token that can't be decoded reads as naming a
 * site, so the verifier reports it as it would any malformed token.
 */
function namesAuthorizedParty(token: string): boolean {
  try {
    return decodeJwt(token).payload.azp !== undefined;
  } catch {
    return true;
  }
}

export function createClerkAuth(clerk: ClerkConfig | null, deps: { log: Log; verify?: VerifyToken }): Authenticator {
  const verify = deps.verify ?? verifyToken;
  return {
    async authenticate(req) {
      if (!clerk) throw new HttpError(503, "auth_unavailable", "Sign-in isn't configured on this server.");
      const token = bearerToken(req);
      if (!token) throw unauthenticated();
      let claims: Record<string, unknown>;
      try {
        // jwtKey and no secretKey: verification can't fall back to fetching keys from Clerk. The exported
        // verifyToken returns the claims and throws a TokenVerificationError, whose `reason` is a code such as
        // "token-expired", for a bad token.
        // `authorizedParties` makes the verifier require an `azp` that is one of our web origins. A native app's token
        // has none (Clerk: "if the azp claim doesn't exist, skip this step"), so it is checked without that option. The
        // check guards against a token leaked to another site through a shared cookie; this api takes Bearer tokens
        // only, never cookies, and the signature, times, subject and session status are checked either way.
        const options = namesAuthorizedParty(token)
          ? { jwtKey: clerk.jwtKey, authorizedParties: clerk.authorizedParties }
          : { jwtKey: clerk.jwtKey };
        claims = (await verify(token, options)) as unknown as Record<string, unknown>;
      } catch (err) {
        const reason = (err as { reason?: unknown } | null)?.reason;
        deps.log("auth.rejected", { reason: typeof reason === "string" ? reason : err instanceof Error ? err.name : "unknown" });
        throw unauthenticated();
      }
      // A pending session hasn't finished a required step (such as choosing an org). Clerk's own SDK treats it as
      // signed out by default, and so do we.
      if (claims.sts === "pending") {
        deps.log("auth.rejected", { reason: "session-pending" });
        throw unauthenticated();
      }
      const caller = callerFromClaims(claims);
      if (!caller) {
        deps.log("auth.rejected", { reason: "no-subject" });
        throw unauthenticated();
      }
      return caller;
    },
  };
}
