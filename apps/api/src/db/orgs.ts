// Orgs: one row per Clerk org, keyed by its id. The webhook mirror fills in more later (ADR 0006).
import { RecordId } from "surrealdb";
import type { Surreal } from "surrealdb";

export const orgRef = (orgId: string) => {
  if (!orgId) throw new Error("orgId is required");
  return new RecordId("org", orgId);
};

export async function upsertOrg(db: Surreal, orgId: string): Promise<void> {
  // created_at is set once, by its DEFAULT, and is READONLY after that.
  await db.query("UPSERT $org", { org: orgRef(orgId) }).retry().collect();
}
