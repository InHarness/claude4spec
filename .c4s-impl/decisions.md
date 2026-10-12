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
