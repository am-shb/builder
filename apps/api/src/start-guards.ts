// Limits on starting sessions (docs/plans/api-first-slice.md, "Start guards"). Every start can send a paid bot, and
// sign-up is open, so one account or org can't start an unbounded number. Each is set by an environment variable;
// these defaults apply when it's unset, so a server is never without them.
export type StartGuards = {
  // MAX_ACTIVE_SESSIONS_PER_ORG: sessions an org may have active (starting, joining or in the meeting) at once.
  maxActivePerOrg: number;
  // MAX_STARTS_PER_ORG_PER_DAY: sessions an org may start in any 24 hours, whatever became of them.
  maxStartsPerOrgPerDay: number;
  // START_RATE_LIMIT_PER_MINUTE: POST /v1/sessions requests one user may make in any minute, reused ones included.
  startsPerUserPerMinute: number;
  // ACTIVE_MARGIN_MINUTES: how long after its time limit a session stops counting as active when no event said it
  // ended (a stopgap until the engine's status events arrive, A2).
  activeMarginMinutes: number;
};

export const DEFAULT_START_GUARDS: StartGuards = {
  maxActivePerOrg: 2,
  maxStartsPerOrgPerDay: 20,
  startsPerUserPerMinute: 5,
  activeMarginMinutes: 10,
};
