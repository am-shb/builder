// The api's database, behind the org-first `Db` functions (docs/plans/api-first-slice.md, step 3). Routes get a
// `Db` and never see SurrealDB.
import { connect } from "./connect.ts";
import type { DbTarget } from "./connect.ts";
import { migrate } from "./migrate.ts";
import { upsertOrg } from "./orgs.ts";
import { applyStatusEvent, createSessionUnlessActive, getSession, listSessions, setSessionStart } from "./sessions.ts";
import type { Db } from "./types.ts";

export type { Db, CreateResult, NewSession, StartLimit, StartLimits, SessionRecord, StartResult, ApiSessionStatus, StatusEventResult } from "./types.ts";
export { StartLimitError } from "./types.ts";
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
    createSessionUnlessActive: (orgId, s, limits) => createSessionUnlessActive(db, orgId, s, limits),
    setSessionStart: (orgId, id, result) => setSessionStart(db, orgId, id, result),
    getSession: (orgId, id) => getSession(db, orgId, id),
    listSessions: (orgId, limit) => listSessions(db, orgId, limit),
    applyStatusEvent: (orgId, id, status, code) => applyStatusEvent(db, orgId, id, status, code),
    // Closing twice is fine.
    close: () => (closing ??= db.close().then(() => {})),
  };
}
