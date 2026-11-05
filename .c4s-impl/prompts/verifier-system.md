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
- Window: `<from>` = `2.1.68`, `<to>` = `2.1.69`
- Working directory: the app at `codebase/apps/claude4spec-app` inside the worktree `.worktrees/2-1-68-to-2-1-69` (monorepo root). All paths below are relative to the app directory.
- Tests — suite: env-runner: full `npm test` + `npm run test:e2e` once, at system verification only (never locally)
- Tests — filtered: none — static verification: read the test bodies named <pattern>, run `npm run typecheck` only (never run tests locally)
- Tests — e2e / smoke: none as separate commands (`app: none`); e2e tests (`npm run test:e2e`, Playwright under `e2e/`) start what they need and run only in env-runner at system verification
- Running app part of the build: no (`app: none`)
- Verifier tools: none
- State dir: `.c4s-impl/`
- Never run tests locally (not even filtered vitest) — the user's standing rule; the only local check is `npm run typecheck`.
- An active `ac` whose `verifies` is empty is **not** a read problem and never a blocking deviation (user's standing decision): its title is the contract, checked against the unit's page sections. Do not ship a patch for it.
- The user-jobs convention points at the modules table (`pages/SKILL.md` §12) — there is no user-jobs table in this specification, so no unit owns a job end-to-end test; the system verifier checks the units' criteria alone.

### Conventions

| label | key | offset | anchor |
|---|---|---|---|
| L14 (CLI Commands) — the layer page names no implementing module | `pages/layers/L14-cli-commands.md` | 0 | `1hlvn21h` |
| L14 (CLI Commands) | `pages/layers/L14-cli-commands.md` | 1 | `flt0hm9r` |
| L17 (Project Settings) — the layer page names no implementing module | `pages/layers/L17-project-settings.md` | 1 | `mj2r93no` |
| L17 (Project Settings) | `pages/layers/L17-project-settings.md` | 2 | `ata1r5sz` |
| Domain (L2) has no page of its own in this release — its conventions live in the modules' `Domain` sections | — | — | — |
| User jobs table for the system verifier (none; nearest is the modules table) | `pages/SKILL.md` | 12 | `45yst8co` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
|---|---|---|---|---|---|---|---|
| ac | criteria | verifies | per-criterion | — | — | verifies | status = deprecated |
| dto | built | — | — | a TypeScript type in src/shared/ (request/response shape shared by server and client) plus the route's input validation for request DTOs | the route supertest (or the producing module's test) asserts the response body has exactly the DTO's fields (required ones present) and that a request violating a request DTO's field rules is rejected | — | — |
| endpoint | built | — | — | an Express route in src/server/routes/<area>.ts (for get-api-spec-skills-exposed-projects: spec-skills.ts) with the record's method and path, answering with its linked response/error DTOs | src/server/routes/<area>.route.test.ts (supertest) asserting method+path, status codes and the linked DTOs' shapes | linkedDtos | — |
| mcp-tool | built | — | — | a tool definition in src/server/mcp/<group>-tools.ts with the record's name, description, params schema, annotation hints and returned payload | src/server/mcp/<group>-tools.test.ts asserting the tool's params schema, hints and payload shape | — | — |
| spec-operation | built | — | — | the operation's entry in the operations catalog src/server/operations/ (catalog.ts / core-operations.ts) carrying scope, mediation, channels, idempotency, error codes and tags, plus its implementation behind the channels | src/server/operations/catalog.test.ts (or the operation's own test) asserting the catalog fields of the record and the behaviour stated in `zachowanie` | cliCommands, mcpTools, restEndpoints, internalTools | — |
| cli-command | built | — | — | a leaf command of the c4s binary in src/bin/c4s/commands/<name>.ts registered in src/bin/c4s.ts, with the record's name, mode, args, flags, output and error codes | src/bin/c4s/commands/<name>.test.ts asserting args/flags, the output streams (stdout/stderr) and exit codes stated by the record | — | — |

For `ac` with `observedIn: per-criterion`: a criterion about what a screen shows or does (e.g. the skills settings card) is checked by a render/component test under `src/client/` or, if it needs the running app, e2e (Playwright under `e2e/`); every other criterion is unit (vitest/supertest). Tests carry `[ac:<slug>]` in their name.

### Entity parts

None — no `per-entity` type is named in this brief's recipes.
