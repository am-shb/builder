// Every request acts within one active org, and the org always comes from the verified token (ADR 0006).
import { HttpError } from "../http.ts";
import type { Caller } from "./clerk.ts";

export type OrgCaller = { userId: string; orgId: string; role: string };

export const ORG_ADMIN = "org:admin";
export const ORG_MEMBER = "org:member";

/** The caller's active org, or 403 `no_active_org`. */
export function requireOrg(caller: Caller): OrgCaller {
  if (!caller.orgId || !caller.orgRole) {
    throw new HttpError(403, "no_active_org", "Choose an organization first: this request needs an active org.");
  }
  return { userId: caller.userId, orgId: caller.orgId, role: caller.orgRole };
}

/** 403 `forbidden` unless the caller's role is one of `roles`. */
export function requireOrgRole(caller: OrgCaller, roles: readonly string[]): OrgCaller {
  if (!roles.includes(caller.role)) {
    throw new HttpError(403, "forbidden", "Your role in this organization can't do that.");
  }
  return caller;
}
