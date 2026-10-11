# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-11)

- Brief: `2-1-12-to-2-1-13-workflow.md` (app-spec / default, 2.1.12 → 2.1.13). 4 units in 3 waves (w1 u1; w2 u2, u4; w3 u3); empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-11-to-2-1-12), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification (`npm ci` from the lockfile, as uid 1000). `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`. One fix round after the env-runner run is budgeted up front.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded). `node_modules` in the worktree is a symlink to the main checkout's.
- No user-jobs table in the spec (brief: the system verifier relies on the units' module criteria) → no `units[].jobs`.
- All recipe addresses (page ranges ↔ anchors, entity slugs) were checked against `release-diff` at set-up: all hold.
- Window entries without a unit (brief "Wpisy okna bez jednostki"): M21 §15 and M23 `m23mcp01` only repoint a reference to the explicit-addressing rule; the module-tag change on `brief-tools-get-brief` / `katalog-operacji-m21` — no code.

## Overrides of the skill (lessons from earlier runs)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages (written into the implementer/verifier prompts as "Build overrides"). (All criteria in this window do have `verifies`.)
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | verifies | status = deprecated | 3 |
| mcp-tool | built (tool registration in src/server/mcp/<server>.ts + vitest `[entity:<slug>]`) | | | | 1 |
| spreadsheet | per-entity | | | | 3 |

## Entity parts

- `katalog-operacji-m10` (spreadsheet) — one part: `built`, items: every operation row, key: `nazwa`. Why: each row is an operation registered in the core operation catalog (channels, addressing, rules, error codes) — system structure.
- `katalog-operacji-m21` (spreadsheet) — same classification, for the brief operations.
