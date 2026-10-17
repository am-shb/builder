# services/worker: background jobs

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
Work that shouldn't happen inside a request.

## In scope
- Calendar integration: syncing users' calendars and scheduling bots for upcoming meetings (Recall's calendar
  integration; v0 put this off)
- Bot lifecycle: Recall status webhooks to replace v0's polling every 4 s, and end-of-call processing that finalizes
  the handoff (known issue I5)
- Generating handoff exports
- Data retention: deleting transcripts and sessions on schedule
- Syncing usage to billing

## Depends on
`db`, the meeting engine, `services/billing`, `services/notifications`

## Open decisions
- Queue and scheduler technology
- Retry and idempotency rules for Recall webhooks

## First tasks
- [ ] List every background job and what triggers it
