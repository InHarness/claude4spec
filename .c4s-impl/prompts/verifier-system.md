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

- Identity flags for every `c4s` command: `--project 'app-spec' --workspace 'default'`
- Window: `<from>` = `2.1.60`, `<to>` = `2.1.62`
- Tests — suite: env-runner: full `npm test` + `npm run test:e2e` once, at system verification only (never locally)
- Tests — filtered: none — static verification: read the test bodies named <pattern>, run `npm run typecheck` only (never run tests locally)
- Tests — e2e / smoke: none as separate commands (`app: none`); e2e tests (`npm run test:e2e`, Playwright under `e2e/`) start what they need and run only in env-runner at system verification
- Running app part of the build: no (`app: none`)
- Verifier tools: none
- State dir: `.c4s-impl/`
- Never run tests locally (not even filtered vitest) — the user's standing rule; the only local check is `npm run typecheck`.
- Runner contract (out of this window's pin): project `--project 'c4s-runner' --workspace 'default'`, pages `modules/M03-control-channel.md`, `modules/M01-runner-process.md`, `modules/M02-master-access.md`, DTOs `host-info`, `closing-event`. M54 only addresses it (section 4, `40kett5w`); read it only as background for the host stub in tests; M54's facts win, a conflict is a deviation.

### Conventions

| label | key | offset | anchor |
|---|---|---|---|
| L4 (API) — implementor M49 | `pages/layers/L4-api.md` | 2 | `pondhd6o` |
| L5 (UI) — implementor M50 | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| L10 (Project Scoping) — implementor M31 | `pages/layers/L10-project-scoping.md` | 2 | `l10slice0` |
| L12 (Host UI Kit) — implementor M34 | `pages/layers/L12-host-ui-kit.md` | 2 | `l12slice0` |
| L17 (Project Settings) — implementor M26 | `pages/layers/L17-project-settings.md` | 2 | `ata1r5sz` |
| User jobs table, for the system verifier (embeds spreadsheet moduly-feature) | `pages/SKILL.md` | 13 | `oq23nb0j` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
|---|---|---|---|---|---|---|---|
| ac | criteria | verifies | per-criterion | — | — | verifies | status = deprecated |
| module-dependency | context | — | — | — | — | — | — |
| endpoint | built | — | — | an Express route handler under src/server/routes/ (router mounted at /api/workspace/runner-hosts, no project prefix) with the endpoint's method, path, status codes and linked request/response/error DTOs | a supertest test in src/server/routes/<name>.route.test.ts hitting method+path and asserting the status codes and response shape named by the endpoint | linkedDtos | — |
| dto | built | — | — | a TypeScript type in src/shared/ (request/response shape shared by server and client) plus the route's input validation for request DTOs | the route supertest asserts the response body has exactly the DTO's fields (required ones present) and that a request violating a request DTO's field rules is rejected | — | — |
| spreadsheet | per-entity | — | — | — | — | — | — |

For `ac` with `observedIn: per-criterion`: a criterion about what the `#runner-hosts` card shows or does (m54-settings-ui) is e2e (Playwright under `e2e/`); every other criterion is unit (vitest/supertest). Tests carry `[ac:<slug>]` in their name.

### Entity parts

| slug | role | items | key | inCode | verify |
|---|---|---|---|---|---|
| moduly-feature | context | all rows; in this window the change is row M54 (row 55) | column `#` (module number) | — | — |
