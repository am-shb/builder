// Tells the api when a session's status changes (A2 in docs/plans/api-first-slice.md, ADR 0008): one
// `session.status` event from @builder/contracts per call to POST {API_INTERNAL_URL}/internal/engine-events, with the
// shared bearer token. Only sessions the api started (they have an org) are reported.
//
// Delivery:
// - Only each session's latest status waits to be sent. A newer one replaces an older one not yet sent (and is sent
//   right away, without waiting out the older one's retry delay), so events never go out of order; the api also
//   refuses to move a session backwards.
// - The event id is fixed for a session and status, so sending it again is harmless.
// - 2xx: delivered. 401, 408, 429, 5xx, a timeout or a network error: tried again, waiting 2 s, then twice as long
//   each time, up to 60 s. So is a 404 for the route itself (an api without it, mid-deploy, or the route turned off):
//   only a 404 that says `session_not_found` is about the event. Any other 4xx (no such session, a malformed event,
//   another session holding the link): logged and dropped, since sending it again can't help. After 6 hours of
//   failing, an event is dropped too, so a wrong token can't keep events forever.
// - A lower status never replaces a higher one waiting (joining < in_meeting < ended or failed), so the restart
//   sweep's slower read can't push back a newer status the poll has just queued.
// - Waiting events are kept in memory. After a restart, `sweep` queues the current status of every org session
//   changed in the last day, and the api ignores what it already has.
// Never logs more than ids, statuses, codes and HTTP statuses.
import { SessionStatusEvent } from "@builder/contracts";
import { contractStatus } from "./app.ts";
import type { StatusChange } from "./app.ts";
import { errorCode } from "./error-code.ts";
import type { Session, Store } from "./store.ts";

type Log = (msg: string, fields?: Record<string, unknown>) => void;

export const EVENTS_PATH = "/internal/engine-events";
const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;
const TIMEOUT_MS = 5_000;
const GIVE_UP_MS = 6 * 60 * 60 * 1000;
const RANK: Record<SessionStatusEvent["status"], number> = { joining: 1, in_meeting: 2, ended: 3, failed: 3 };
export const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Recall's sub-codes are plain snake_case codes; anything else is sent as a generic one.
const CODE = /^[a-z0-9_]{1,64}$/;

// Why the bot ended or failed: Recall puts the reason (bot_kicked_from_call, meeting_not_found, ...) on the call_ended
// or fatal change, and the `done` that follows has none. So the latest of those with a sub-code, else the session's own.
function reason(s: Session, changes: readonly StatusChange[]): string | null {
  const c = changes.findLast((x) => (x.code === "call_ended" || x.code === "fatal") && x.sub_code);
  const code = c?.sub_code ?? s.bot_sub_code;
  return code && CODE.test(code) ? code : null;
}

/**
 * The event for a session as it now stands, or null if the api didn't start it. `errorCode`: for failed, Recall's
 * reason or bot_failed; for ended, the engine's own limit (max_minutes, max_usd) or Recall's reason, if any.
 */
export function statusEvent(s: Session, at: Date, changes: readonly StatusChange[] = []): SessionStatusEvent | null {
  if (!s.org_id || s.state !== "created") return null;
  const status = contractStatus(s);
  const code = status === "failed" ? reason(s, changes) ?? "bot_failed"
    : status === "ended" ? s.end_reason ?? reason(s, changes) ?? undefined
    : undefined;
  return SessionStatusEvent.parse({
    id: `${s.id}:status:${status}`,
    type: "session.status",
    sessionId: s.id,
    orgId: s.org_id,
    at: at.toISOString(),
    status,
    ...(code ? { errorCode: code } : {}),
  });
}

type Waiting = { event: SessionStatusEvent; attempts: number; nextAt: number; since: number };

export type StatusReporter = {
  /** Queues the session's current status for the api, if it's new. Never throws. */
  notify(s: Session, changes?: readonly StatusChange[]): void;
  /** Sends what's due. One run at a time; never rejects. */
  flush(): Promise<void>;
  /** After a restart: queues the status of every org session changed since `since`. Never rejects. */
  sweep(since: Date): Promise<void>;
  /** Events still waiting to be delivered (tests, logs). */
  waiting(): number;
};

export function createStatusReporter(deps: {
  apiUrl: string;
  token: string;
  store: Pick<Store, "listOrgSessionsUpdatedSince">;
  log: Log;
  fetch?: typeof fetch;
  clock?: () => number;
  timeoutMs?: number;
}): StatusReporter {
  const send = deps.fetch ?? fetch;
  const clock = deps.clock ?? Date.now;
  const url = `${deps.apiUrl}${EVENTS_PATH}`;
  const waiting = new Map<string, Waiting>();
  // The last event id the api took for each session, so the same status isn't sent twice. Dropped once a final
  // status is delivered, so it doesn't grow with every session ever run.
  const delivered = new Map<string, string>();
  let running: Promise<void> | null = null;

  function notify(s: Session, changes: readonly StatusChange[] = []) {
    try {
      const event = statusEvent(s, new Date(clock()), changes);
      if (!event) return;
      const queued = waiting.get(s.id)?.event;
      if (delivered.get(s.id) === event.id || queued?.id === event.id) return;
      if (queued && RANK[queued.status] > RANK[event.status]) return;
      waiting.set(s.id, { event, attempts: 0, nextAt: clock(), since: clock() });
      void flush();
    } catch (err) {
      deps.log("api_events.queue_failed", { session_id: s.id, error: errorCode(err) });
    }
  }

  type Outcome = "delivered" | "retry" | "dropped";

  async function deliver(event: SessionStatusEvent): Promise<{ outcome: Outcome; status: number | string }> {
    try {
      const res = await send(url, {
        method: "POST",
        headers: { authorization: `Bearer ${deps.token}`, "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      });
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        return { outcome: "delivered", status: res.status };
      }
      if (res.status === 404) {
        // Only the api's own "no such session" is final; any other 404 means the route isn't there (yet).
        const code = await res.json().then((b: { error?: { code?: unknown } }) => b?.error?.code, () => undefined);
        return { outcome: code === "session_not_found" ? "dropped" : "retry", status: res.status };
      }
      await res.body?.cancel().catch(() => {});
      const again = res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
      return { outcome: again ? "retry" : "dropped", status: res.status };
    } catch (err) {
      return { outcome: "retry", status: errorCode(err) };
    }
  }

  // Until nothing is due: a status queued while this run is sending goes out in the same run. Each waiting event is
  // tried once per run, so an api that's down doesn't keep it busy.
  async function sendDue() {
    const tried = new Set<Waiting>();
    const due = () => [...waiting].find(([, w]) => w.nextAt <= clock() && !tried.has(w));
    for (let next = due(); next; next = due()) {
      const [sessionId, w] = next;
      tried.add(w);
      const { outcome, status } = await deliver(w.event);
      // A newer status may have replaced this one while it was being sent: that one stays queued.
      const current = waiting.get(sessionId);
      const replaced = current !== w;
      const fields = { session_id: sessionId, status: w.event.status, http: status };
      if (outcome === "delivered") {
        if (!replaced) waiting.delete(sessionId);
        if (w.event.status === "ended" || w.event.status === "failed") delivered.delete(sessionId);
        else delivered.set(sessionId, w.event.id);
        deps.log("api_events.delivered", fields);
      } else if (outcome === "dropped") {
        if (!replaced) waiting.delete(sessionId);
        deps.log("api_events.dropped", fields);
      } else if (!replaced) {
        w.attempts += 1;
        if (clock() - w.since >= GIVE_UP_MS) {
          waiting.delete(sessionId);
          deps.log("api_events.gave_up", { ...fields, attempts: w.attempts });
          continue;
        }
        w.nextAt = clock() + Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (w.attempts - 1));
        // The first few, then every tenth: an api that's down for hours doesn't fill the log.
        if (w.attempts <= 3 || w.attempts % 10 === 0) deps.log("api_events.retry", { ...fields, attempts: w.attempts });
      }
    }
  }

  function flush(): Promise<void> {
    running ??= sendDue()
      .catch((err) => deps.log("api_events.flush_failed", { error: errorCode(err) }))
      .finally(() => { running = null; });
    return running;
  }

  async function sweep(since: Date) {
    try {
      const sessions = await deps.store.listOrgSessionsUpdatedSince(since);
      for (const s of sessions) notify(s);
      deps.log("api_events.swept", { sessions: sessions.length });
    } catch (err) {
      deps.log("api_events.sweep_failed", { error: errorCode(err) });
    }
  }

  return { notify, flush, sweep, waiting: () => waiting.size };
}
