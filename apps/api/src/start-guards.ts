// Limits on starting sessions (docs/plans/api-first-slice.md, "Start guards"). Every start can send a paid bot, so
// one org or one person (in every org they belong to, since anyone can make orgs) can't start an unbounded number.
// Each is set by an environment variable; these defaults apply when it's unset, so a server is never without them.
// "Active" counts sessions that hold a place: starting, joining, in the meeting or unconfirmed, until their time
// limit plus the margin.
export type StartGuards = {
  // MAX_ACTIVE_SESSIONS_PER_ORG: sessions an org may have active (starting, joining or in the meeting) at once.
  maxActivePerOrg: number;
  // MAX_STARTS_PER_ORG_PER_DAY: sessions an org may start in any 24 hours, whatever became of them.
  maxStartsPerOrgPerDay: number;
  // MAX_ACTIVE_SESSIONS_PER_USER: sessions one person may have active at once, across every org.
  maxActivePerUser: number;
  // MAX_STARTS_PER_USER_PER_DAY: sessions one person may start in any 24 hours, across every org.
  maxStartsPerUserPerDay: number;
  // START_RATE_LIMIT_PER_MINUTE: POST /v1/sessions requests one user may make in any minute, reused ones included.
  startsPerUserPerMinute: number;
  // ACTIVE_MARGIN_MINUTES: how long after its time limit a session stops counting as active when no event said it
  // ended (a stopgap until the engine's status events arrive, A2). The time limit runs from when the bot is let in,
  // so the margin covers the wait in the meeting's lobby too.
  activeMarginMinutes: number;
};

export const DEFAULT_START_GUARDS: StartGuards = {
  maxActivePerOrg: 2,
  maxStartsPerOrgPerDay: 20,
  maxActivePerUser: 2,
  maxStartsPerUserPerDay: 20,
  startsPerUserPerMinute: 5,
  activeMarginMinutes: 30,
};
