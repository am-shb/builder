# Contributing

1. **Pick work.** Claim an area in [docs/workstreams.md](docs/workstreams.md), or an item in
   [docs/known-issues.md](docs/known-issues.md).
2. **Decide first.** If the work makes a choice that others will build on, such as a framework, a provider or a schema,
   write an ADR in `docs/adr/` from the template and get it merged before the code.
3. **Branch.** Name it `<area>/<short-description>`, for example `billing/usage-metering`. Never push directly to
   `main`.
4. **Build.** Stay inside your area's folder, add tests, and follow [AGENTS.md](AGENTS.md).
5. **Open a PR.** Fill in the template. `npm test` and `npm run smoke` must pass. The area owner reviews; changes to
   shared shapes also need the owner of `packages/shared`.
6. **Keep docs current.** Update your area's README (status, decisions, first tasks) in the same PR.
