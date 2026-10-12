# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-12)

- Brief: `2-1-14-to-2-1-15-workflow.md` (app-spec / default, 2.1.14 → 2.1.15). 3 units in 2 waves (w1: u1-prompt-block-style-author, u2-writing-style-author-two-routes; w2: u3-reference-style-routing ← u2); empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-13-to-2-1-14, commit 3e9a2bc5), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification. `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented` before the merge: the brief is marked after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded). `node_modules` in the worktree is a symlink to the main checkout's.
- User jobs: at 2.1.15 `pages/SKILL.md` has no user-jobs table (the brief says so); the system verifier uses the module table (§13 `oq23nb0j`) and the plugin-module table (§14 `zpn3gaip`) → no `units[].jobs`.
- Brief section numbers are read as 0-based offsets (the anchors confirm them at read time).

## Overrides of the skill (lessons from earlier runs)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages ("Build overrides" in the prompts).
- Criteria about what an agent running a skill does are proven by tests over the skill text as shipped in its envelope.
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks / links | inCode | v |
| --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | — (inactive: status = deprecated) | 3 |
| code-snippet | built | | the `<project_writing_skill>` block text (system-prompt/blocks/m15-writing-style.ts) + test `[entity:<slug>]` | 1 |
| module-dependency | context | | — | 1 |

## Loop (orchestrator)

- Gate 'next window exists' (2-1-15-to-2-1-16.md pending): durable user rule — one brief per PR; finish this window, PR + merge, the next brief runs as its own loop after the merge. Not a stop.
- Split runs of the wave-1 units run up front in parallel (split mode reads only and writes no state); build/verify/review runs stay strictly sequential.
