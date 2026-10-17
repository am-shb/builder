# db: schema and migrations

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Current state
v0 uses `node:sqlite`, with the schema created in `src/store.ts`. It has tables for sessions, events (the utterances),
the consensus document and prototype, and model calls.

## In scope
- The production database and its migration tool
- Multi-tenancy: an `org_id` on every row, and how access is enforced
- Retention and deletion of transcripts and recordings (see `docs/security/`)
- Backups and restore

## Open decisions
- Database engine and hosting
- How to migrate off the v0 SQLite schema. There's no production data to carry over.

## First tasks
- [ ] A target entity diagram: orgs, users, meetings, sessions, utterances, decisions, prototypes, usage
