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

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something, no fallback, alias or dead code path survives, and no test asserts the old behaviour any more. (This window's goals say "nothing is removed" — do not remove existing registry operations or change their signatures.)
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly, async/microtask timing, background work outliving the test (the runner-host supervisor, its timers, open HTTP/SSE connections and stub servers must be stopped/closed in `afterEach`, otherwise vitest "Unhandled Errors" or hanging workers), tests touching `~/.claude4spec` (registry `workspaces.json`, the secrets key file) must use a temp HOME / registry dir, never the developer's real one. Timeouts/backoff (3 s first event, 20 s liveness, retry spacing) are tested with fake timers or injectable clocks, never by real waiting. A runner host in tests is a local HTTP stub server on an ephemeral port (`GET /host`, `GET /host/events` as an event stream) — never a real `c4s-runner`.
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, cache invalidation wider than what actually changed, full re-reads where a narrower read suffices, recomputation on the server, blocking the event loop — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
- **Secrets.** A plain token never lands in a file, a log line, an API response or `lastError` — tests for these criteria assert on the real artefacts (file bytes, captured logs, response bodies).
