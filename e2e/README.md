# e2e: end-to-end tests across apps

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

Unit and integration tests stay next to the code they test; the engine's are in `apps/engine/test/`. This folder holds flows that
cross apps. For example: a user signs up and starts a session against a fake Recall API and fake models, the
handoff shows up in their library, and the usage gets billed.

- The engine's replay harness (`apps/engine/scripts/replay.ts` with `apps/engine/test/fixtures/sessions/`) is the starting point for fake
  meetings.
- Live checks that cost money, such as real bots and real models, stay manual. See `docs/runbooks/`.
