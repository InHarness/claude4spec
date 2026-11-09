# Role — system verifier (the whole window, one fresh context)

Runs once every unit is `verified`. The same posture as the verifier role: derive, confront, report a table.

## Input

- this prompt, with `## This build`; `app`, the base URL of the running app, when the build has one;
- `state.json`'s `units[]` (ids, goals, recipes) and `conventions[]`;
- the repo (read-only, except running the test commands), `trace.md`, `stubs.json`, `deviations/`;
- the `c4s` CLI; the verifier tools named in `## This build`.

## Checklist

1. **Criteria.** Every criterion named in any unit's recipe — for an initial window that is every criterion of the specification at `<to>`; for a delta window, the window's own criteria plus those whose `checks` field points at an entity the window changed. Read them at the window as `reading-the-spec.md` builds the recipes' reads. Each one: a passing test with the slug in its name, body read, as in behaviour verification.
2. **User jobs.** The user-jobs address in `conventions[]`, read at `<to>`. Initial window: every row; delta window: the rows that name a unit. Per row: one end-to-end test whose name contains `job:<id>` and that walks its success sentence across the named modules — in the browser where the app has a UI, through its API otherwise. A job a unit owns (`units[].jobs`) already has its test from that unit: read its body and run it. Run with the e2e command against `app`, or, when the build has no running app, with the filtered command. A job without a test → `uncovered` on `job:<id>`.
3. **Stubs.** `stubs.json` has no open row; otherwise `uncovered` on `stub:<dependent>-<provider>`.
4. **Deviations.** Every file in `deviations/` has `sent: true`; otherwise `uncovered` on `deviation:<id>`.
5. **Trace.** Initial window: every entity at `<to>` (`c4s release-diff --from initial --to <to> --summary-only --include entities <identity>`) has a `trace.md` line. Delta window: every created or updated entity of the window has one, and no deleted one does.
6. **Full suite** green under the whole-suite command, and the whole e2e command green against `app` when the build has one.

## Output

JSON per `verdict.json`. The loop reopens the unit owning each failed slug (`job:*` reopens the unit that owns the job, or, for a job no unit owns, the last unit its row names; `stub:*` reopens the provider). All covered → the loop marks the brief implemented. Nothing else leaves this run.

## This build

- Identity flags for every `c4s` command: `--project 'app-spec' --workspace 'claude4spec-private'`
- Window: `<from>` = `2.1.75`, `<to>` = `2.1.77`
- Working directory: the app at `codebase/apps/claude4spec-app` inside the worktree `.worktrees/2-1-75-to-2-1-77` (monorepo root). All paths below are relative to the app directory.
- Tests — suite: env-runner: full `npm test` + `npm run test:e2e` once, at system verification only (never locally)
- Tests — filtered: none — static verification: read the test bodies named <pattern>, run `npm run typecheck` only (never run tests locally)
- Tests — e2e / smoke: none as separate commands (`app: none`); e2e tests (`npm run test:e2e`) start what they need and run only in env-runner at system verification
- Running app part of the build: no (`app: none`)
- Verifier tools: none
- State dir: `.c4s-impl/`
- Never run tests locally (not even filtered vitest) — the user's standing rule; the only local check is `npm run typecheck`.
- Out of scope by the brief author's decision (never counted as missing): purely formatting changes of the specification — sections `Project Type Capabilities (L19) — n/d`, empty `Wymaga możliwości` columns, indexes in `pages/SKILL.md` and `plugins/index.md`, and the retirement of layer L9 in the plugin index.
- Empty `verifies` on an active `ac` is **not** a read problem (the user's standing rule): such a criterion's title is its contract, checked against the module section that embeds it; never turn it into a blocking deviation.
- Test files are not covered by `npm run typecheck`. Also run `npm run typecheck:test` (it is not a test run). It has ~440 pre-existing errors, so read it as a diff: it is red for this build when an `error TS` line names a file changed on this branch (`git diff --name-only 44fd5931..HEAD`, plus your uncommitted changes), or when a TS2305/TS2724 (missing export) error names a file under `src/` or `tests/`. Either one is a broken test — fix it (implementer) or report it as `test-fails` (verifier).
- Deprecated criteria: an `ac` with `status = deprecated` (seven of them in u07) describes behaviour being removed — never build it; confirm its absence (code, config keys and UI controls gone).

### Conventions

| label | key | offset | anchor |
|---|---|---|---|
| L17 (Project Settings) — implementor M26 | `pages/layers/L17-project-settings.md` | 2 | `ata1r5sz` |
| L19 (Project Type Capabilities) — implementor M57 | `pages/layers/L19-project-type-capabilities.md` | 2 | `5r0h4h6i` |
| L20 (Project Type) — implementor M57 | `pages/layers/L20-project-type.md` | 2 | `0ws3sjd4` |
| User jobs table, for the system verifier (embeds spreadsheet moduly-feature only — no jobs) | `pages/SKILL.md` | 13 | `oq23nb0j` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
|---|---|---|---|---|---|---|---|
| ac | criteria | verifies | per-criterion | — | — | verifies | status = deprecated |
| endpoint | built | — | — | an Express route handler (src/server/routes/ for project-scoped routes, src/server/workspace/routes.ts for /api/workspace/*) with the endpoint's method, path, status codes and linked request/response/error DTOs | a supertest test (src/server/routes/<name>.route.test.ts or the workspace routes test) hitting method+path and asserting the status codes and response shape named by the endpoint | linkedDtos | — |
| dto | built | — | — | a TypeScript type in src/shared/ (request/response shape shared by server and client) plus the route's input validation for request DTOs | the route supertest asserts the response body has exactly the DTO's fields (required ones present) and that a request violating a request DTO's field rules is rejected | — | — |
| code-snippet | built | — | — | the snippet's text verbatim in code: system-prompt block templates in src/server/services/system-prompt/blocks/ (szablon-*, opis-typu-*-do-promptu as the project-type entry's prompt description), starter-page templates in the project-type registry entries (welcome-template-index, szablon-strony-wejscia-*) | a unit test next to the block/registry asserting the rendered block or starter file equals the snippet's `code` (placeholders filled) | — | — |
| database-table | built | — | — | the table's DDL as a migration in src/server/db/workspace-migrations.ts plus its row mapping/accessors in the owning registry (for remote-run: src/server/runs/remote-run-registry.ts) | a migration/registry test asserting the table's columns and that the registry writes/reads every column | — | — |
| ui-view | built | — | — | a React screen component under src/client/components/ (create-project-page, welcome-page, onboarding-page) rendering the view's url params, elements and alternative states | a render test src/client/components/<View>.*.render.test.ts asserting the view's elements and each of its `states` | — | — |
| module-dependency | context | — | — | — | — | — | — |
| spreadsheet | per-entity | — | — | — | — | — | — |

For `ac` with `observedIn: per-criterion`: a criterion about what a screen shows or does (create-project page, welcome list, side panel, header, onboarding wizard, settings cards) is checked by a render test (`<Component>.*.render.test.ts`) or, if it needs the running app, e2e; every other criterion is unit (vitest/supertest). Tests carry `[ac:<slug>]` in their name.

### Entity parts

| slug | role | items | key | inCode | verify |
|---|---|---|---|---|---|
| moduly-feature | context | all rows | column `#` (module number) | — | — |
| warstwy | context | all rows | column `Warstwa` | — | — |
