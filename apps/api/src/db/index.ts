// The api's database, behind the org-first `Db` functions (docs/plans/api-first-slice.md, step 3). Routes get a
// `Db` and never see SurrealDB.
import { connect } from "./connect.ts";
import type { DbTarget } from "./connect.ts";
import { migrate } from "./migrate.ts";
import { upsertOrg } from "./orgs.ts";
import { createSessionUnlessActive, getSession, listSessions, setSessionStart } from "./sessions.ts";
import type { Db } from "./types.ts";

export type { Db, CreateResult, NewSession, SessionRecord, StartResult, ApiSessionStatus } from "./types.ts";
export type { DbTarget } from "./connect.ts";

/**
 * Opens the database. `url` set: that SurrealDB server, already migrated by `npm run migrate -w @builder/api`.
 * Otherwise SurrealDB in this process, in the SurrealKV folder `path`, or in memory when that is absent too
 * (tests), migrated here.
 */
export async function openDb(target: DbTarget = {}): Promise<Db> {
  const db = await connect(target);
  if (!target.url) {
    try {
      await migrate(db);
    } catch (err) {
      await db.close().catch(() => {});
      throw err;
    }
  }
  let closing: Promise<void> | undefined;
  return {
    upsertOrg: (orgId) => upsertOrg(db, orgId),
    createSessionUnlessActive: (orgId, s) => createSessionUnlessActive(db, orgId, s),
    setSessionStart: (orgId, id, result) => setSessionStart(db, orgId, id, result),
    getSession: (orgId, id) => getSession(db, orgId, id),
    listSessions: (orgId, limit) => listSessions(db, orgId, limit),
    // Closing twice is fine.
    close: () => (closing ??= db.close().then(() => {})),
  };
}
