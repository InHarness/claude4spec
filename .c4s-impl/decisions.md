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

## m31-registry-edge-cases / p1-l5-l14 (implementer, round 1)

- `codeToExit` moved from `src/bin/c4s.ts` to `src/bin/c4s/errors.ts` (exported) so the exit status of `REGISTRY_READ_FAILED` is testable without running the bin's `main()`. Behaviour unchanged.
- Launcher parsing carved out of `src/bin/claude4spec.ts` into `src/bin/launch.ts` (`parseLaunchArgs`, `workspaceOnlyLaunch`, `printStartWarnings`); the bin runs on import, so it could not be tested.
- Registry read now rejects a damaged workspace RECORD (non-string name, non-number defaultPort, non-array projects, a project without string cwd) as a read failure, so `c4s list-workspaces` never prints a partial/garbage list.
- New start warning `defaultPublicUrlWarning` (non-loopback listen + no publicUrl) — was missing in code although described in 2.1.11.
- Partial-build cleanup now also releases the context's MCP server factories (`pluginHost.clearMcpFactories()`), matching `dispose` (unit goal: MCP servers live as long as the context instance).
- `ac-projekt-bez-zgody-trustprojectplugins` and the unit goal's MCP-lifetime rule are proven on a REAL `buildProjectContext` (behind the real `ProjectContextCache` + `projectDispatchMiddleware`, `C4S_HOME` pointed at a temp dir) in `tests/integration/api/project-context-m31-edge-cases.test.ts` — the first test in the repo that builds a whole context; the committed fixture plugin writes a sentinel file on import, so "no plugin code ran" is observable.

## m31-remove-project-ui / p1-l5-l17 (implementer, round 1)

- Removed criterion `ac-po-udanym-usunieciu-projektu-detach-lub`: its `[ac:]` marker dropped from `tests/e2e/welcome-routing.test.ts`; the case stays as an unmarked browser check (detach of the last project lands on `/welcome`). The old "no projects" screen was already gone in code (0.1.137); its replacement is the `/welcome` `empty` state.
- `project-detach` / `project-purge` window bodies and the `PROJECT_BUSY` toast aligned verbatim with M31 `m31l5001` Okna; the busy toast now keys on the `PROJECT_BUSY` code rather than any 409. The purge e2e text assertions (`ac-akcja-purge-usun-projekt-i-dane-c4s`) were updated to the new body only because the text they matched changed.
- Full-document navigation moved behind `src/client/lib/document-nav.ts` (`navigateDocument`) in DangerZoneElement, ProjectCreate and WelcomePage, so happy-dom tests can observe it (same pattern as `lib/project-reload.ts`).
- `ac-purge-ostatniego-projektu-workspace-u` is proven in two halves: client (DangerZoneElement.render.test.ts — null redirect → `/`) and server (workspace-projects.test.ts — purge answers `redirectProjectId: null`, `/` resolves to `/welcome`). `ac-dodanie-z-modala-sciezki-nieistniejac-2`: client (no navigation / success) + server (refused POSTs leave the registry unchanged; EACCES via an `fs.accessSync` spy, since chmod is a no-op under a root runner).

## System verification fix round (2026-10-11)

- env-runner run 1 found that `release-0-2-13-contract.test.ts` still read `src/bin/c4s.ts` for `codeToExit` (moved to `src/bin/c4s/errors.ts`). The fix points the 3 tests at `errors.ts` and adds an assertion that `c4s.ts` imports `codeToExit` from there. The reopened unit is proven by re-running the file in the env (no static re-verify for a 3-line test-only change); it lands as a fix commit on top, because the unit commit is no longer HEAD.
