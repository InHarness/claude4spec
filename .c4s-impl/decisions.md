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

## u2-writing-style-author-two-routes / p1-l11-l11

- The skill recognises a `brief`/`ask` thread by `update_skill_file` missing from its tools (true for both; `ask` may still carry page-tools under forced plan mode), and then writes on neither route — no `create_page`/`update_sections` either. One signal for both routes keeps the instruction a rule, not a per-context list.
- Route B names the base root as "the built-in pages root, usually `rootId: \"pages\"`" and the entry as `skill.entry` (default `index.md`, `DEFAULT_SKILL_ENTRY`) — the skill reads config, it never writes it.
- Criteria are proven over the skill text as shipped (`plugins/c4s-plugin-writing-style-author/test/skill-contribution.test.ts`, describe "two routes (2.1.15)"); the two pre-existing `[ac:]` tests in `src/server/routes/agent-turn.test.ts` were updated to the new titles/text.
- The removed claim ("the style author's scaffold does not pass the direct-file-access block") had no counterpart in code: `c4s-plugin-skill-author`'s SKILL.md and description never carried it. Nothing to remove.

## u3-reference-style-routing / p1-l11-l11

- (a)–(c) of `n0fj7m42` were already in code before this window (read/plan/apply/brief-workflow split, SKILL.md route table, no `daily.md`); the portion adds the `[section:n0fj7m42]` tests over the shipped package (`plugins/c4s-plugin-layered-vertical-slices/test/skill-contribution.test.ts`).
- (d) "how a user makes their own style" has its code counterpart in `writing-style-author`'s listing description (built by u2); proven by a `[section:n0fj7m42]` test in `plugins/c4s-plugin-writing-style-author/test/skill-contribution.test.ts`.
- dev-0001: the `daily.md` obligations of `x4imgq6m` are carried by plan.md (protocol referral, translation: one edge tagged by the requiring module, residual question first) and apply.md (drift check incl. Dom 1–6, rule 3/3a symptoms, rule 1 without diagram; closed review-report set). The `Domain` rules block is split plan (residual test, three questions, four shapes) / apply (form, catalogue, item 7) rather than copied whole into both, since one thread loads both and the package forbids a part spliced into two of read/plan/apply. Only text edit: plan.md's cross-module bucket now states the requiring module's tag outright.

## System verification (env-runner `impl-2-1-15-wf`, HEAD a62f3ced)

- `npm test`: 447/447 files, 5448/5448 tests green (npm ci from lockfile as uid 1000).
- `npm run test:e2e`: 207 passed, 19 skipped, 4 failed + 3 suites failing in setup — all outside this window's diff (skill text, prompt template, their tests):
  - seed preconditions of the empty-seed env: artifact-threads-panel ("no plan"), plan-footer ("no plan with a non-empty body"), entity-version-history + envelope-entity-pages x2 ("no endpoint — seed one first"), frontend-mockups-envelope `/design-system` (seed whitelist omits design-system);
  - editor-l8-contexts "new user root gets the full page context" — the known non-validated-root caret flake, pre-existing on main.
- Static system verifier: 20/20 rows covered. terminate() holds; `c4s mark-brief-implemented` runs after the merge.
