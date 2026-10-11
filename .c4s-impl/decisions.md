# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-11)

- Brief: `2-1-11-to-2-1-12.md` (app-spec / default, 2.1.11 → 2.1.12). 2 units, both in wave 1; empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-9-to-2-1-10-workflow), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification (`npm ci` from the lockfile, as uid 1000). `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`. One fix round after the env-runner run is budgeted up front.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded).
- No user-jobs table in the spec (the module table in SKILL.md §13 stands in for the system verifier) → no `units[].jobs`.
- Pages changed in the window outside M31 (M01, M11, M12, M13, M22, M24, M29, M33, M37, M41, M43, M49, M50, the spec index, the `ui-view` type page, the M01 CLI flag sheet, two updated criteria of M01/M17) only repoint references — no unit, no code (per the brief).

## Overrides of the skill (lessons from earlier runs)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages (written into the implementer/verifier prompts as "Build overrides").
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD`.
- UI criteria (m31-remove-project-ui) are proven by frontend unit tests (vitest + jsdom), `observedIn: unit`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | verifies | status = deprecated | 3 |
| ui-view | built (client screen + jsdom test `[entity:<slug>]`) | | | | 4 |
| spreadsheet | per-entity | | | | 3 |

## Entity parts

- `moduly-feature` (spreadsheet) — one part: `context`, items: all. Why: a table of module scopes (spec documentation); the only change in the window is M31's layer list (L2 → L16), with no counterpart in code.
