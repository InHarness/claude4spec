# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-12)

- Brief: `2-1-13-to-2-1-14-workflow.md` (app-spec / default, 2.1.13 → 2.1.14). 15 units in 2 waves (w1: 13 independent units; w2: m10-zapis-planu ← m42-zapis-bez-lancucha, m28-gitsync-konsumenci ← m28-bramki-git); empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-12-to-2-1-13, commit 9df095c), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification (`npm ci` from the lockfile, as uid 1000). `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`. One fix round after the env-runner run is budgeted up front.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded). `node_modules` in the worktree is a symlink to the main checkout's.
- User jobs: the brief's "tabela zadań użytkownika" (`pages/SKILL.md` §12–14) is the module catalog `moduly-feature` (columns #, Moduł, Złożoność, Warstwy, Zakres, Plik) — it lists modules, not user jobs → no `units[].jobs`; the system verifier relies on the units' module criteria.
- Conventions with a range whose anchors the brief elides (`L3` sections 3–8) are stored with offset only.

## Overrides of the skill (lessons from earlier runs)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages (written into the implementer/verifier prompts as "Build overrides").
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks / links | inCode | v |
| --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | — (inactive: status = deprecated) | 3 |
| mcp-tool | built | | tool registration in src/server/mcp/<server>.ts + vitest `[entity:<slug>]` | 1 |
| dto | built | | TS type of the payload of the carrying route + route test `[entity:<slug>]` | 2 |
| endpoint | built | linkedDtos | Express route in src/server/routes/<area>.ts + supertest `[entity:<slug>]` | 3 |
| code-snippet | built | | the generated text it shows (wpis-serwera-c4s-reader → mcp-config entry) + test `[entity:<slug>]` | 1 |
| spreadsheet | per-entity | | see parts | 3 |

## Entity parts

- `katalog-operacji-m02` (spreadsheet) — one part: `built`, items: every operation row, key: `nazwa`. Why: each row is an operation registered in the core operation catalog (channels, addressing, rules, error codes) — system structure.
- `katalog-operacji-m21` (spreadsheet) — same classification, for the brief operations.

## Loop (orchestrator)

- Gate 'next window exists' (2-1-14-to-2-1-15-workflow.md pending): durable user rule — one brief per PR; finish this window, PR + merge, the next brief runs as its own loop after the merge. Not a stop.
- The split runs of all wave-1 units were run up front, in parallel (split mode reads only and writes no state, so the result is the one a sequential run would derive); each unit's portions are recorded in state.json when the unit starts. Build/verify/review runs stay strictly sequential.

- m42-zapis-bez-lancucha/p1-domain-l7: `RecordStore.write` already accepted `chain: false` (skips step 5, steps 1–4 unchanged, token retired via `releaseSuppress`, answer = committed bytes with `staleProjections: []`), so no behaviour change was needed; the docblocks now state the 2.1.14 contract (chain called after commit only unless switched off) and tests `[section:544jcpq5]` / `[section:79m2bhz3]` in src/server/fs/record-store.test.ts prove it. `move`/`remove` keep running their chain unconditionally — the section speaks of the write sequence only.

- m28-bramki-git/p1-domain-l4: `GitService` already had the 2.1.14 shape (gated entries `commitOnRelease`/`pushOnPush` answering `null`, executions `commit`/`push`, `commitPull` → `skipped`, `named`/`new` not reading HEAD, private `resolveDefaultBranch`, no `commitForRelease`, message without `Release `), so no behaviour change was needed. The spec now states the un-prefixed message, so the `ASSUMPTION:dev-0013` markers (git.ts, releases.test.ts) were replaced by spec references; docblocks state the entry-vs-execution contract; `GitRepoInfo.branch` doc follows the dto's new `branch` description (type unchanged). The 19 criteria are proven by new tests in src/server/services/git.test.ts (service), src/server/routes/releases.test.ts (branch-missing / base-missing: release stays created) and src/server/routes/release-pushes.test.ts (push errors keep the push a success; the pushed branch is the one carrying the marker commit, HEAD as fallback). The UI half of `ac-gdy-docelowy-branch-tryb-named-zniknal` (kind-aware recovery window) is L5, outside this portion's layers; `GitSyncRecover.tsx` already maps `branch-missing`.
- m28-bramki-git/p1-domain-l4 (round 2, only: ac-gdy-docelowy-branch-tryb-named-zniknal, ac-gdy-git-add-niczego-nie-wniosl-commi): the client halves already held in code — `CreateReleaseDialog.tsx` opens `git-sync-recover` only on `gitSync.status === 'error'` (so `nothing-to-commit` gives no toast and no window) and `GitSyncRecover.tsx` maps `kind: 'branch-missing'` to its own hint. No code change; the asserting tests are in the new src/client/components/CreateReleaseDialog.render.test.ts (dialog → POST /api/releases → window/no signal; the branch-missing window rendered with its kind hint; the release stays created and the dialog navigates to it).
