# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-09)

- Brief: `2-1-9-to-2-1-10-workflow.md` (app-spec / default, 2.1.9 → 2.1.10). 4 units, one per wave; empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-8-to-2-1-9-workflow-3), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification. `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`. One fix round after the env-runner run is budgeted up front.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded).
- No user-jobs table in the spec (the module table in SKILL.md §13 stands in for the system verifier) → no `units[].jobs`.

## Overrides of the skill (lessons from the previous run)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages (written into the implementer/verifier prompts as "Build overrides").
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD` — a verifier reopen moves `startCommit`, and the first review would otherwise see only the fix.
- UI criteria (u3, u4) are proven by frontend unit tests (vitest + jsdom), `observedIn: unit`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | verifies | status = deprecated | 3 |
| endpoint | built | | linkedDtos[].dto | | 3 |
| dto | built | | | | 2 |
| module-dependency | context | | | | 1 |
