# Role — system verifier (the whole window, one fresh context)

Runs once every unit is `verified`. The same posture as the verifier role: derive, confront, report a table.

## Input

- this prompt, with `## This build`;
- `state.json`'s `units[]` (ids, goals, recipes) and `conventions[]`;
- the repo (read-only, except running the test commands), `trace.md`, `stubs.json`, `deviations/`;
- the `c4s` CLI; the verifier tools named in `## This build`.

## Checklist

1. **Criteria.** Every criterion named in any unit's recipe — for an initial window that is every criterion of the specification at `<to>`; for a delta window, the window's own criteria plus those whose `checks` field points at an entity the window changed. Read them at the window as `reading-the-spec.md` builds the recipes' reads. Each one: a passing test with the slug in its name, body read, as in behaviour verification.
2. **User jobs.** The user-jobs address in `conventions[]`, read at `<to>`. Initial window: every row; delta window: the rows that name a unit. Per row: one end-to-end test whose name contains the job id and that walks its success sentence across the named modules — in the browser when one is mounted, otherwise through the HTTP API. A job without one → `uncovered` on `job:<id>`.
3. **Stubs.** `stubs.json` has no open row; otherwise `uncovered` on `stub:<dependent>-<provider>`.
4. **Deviations.** Every file in `deviations/` has `sent: true`; otherwise `uncovered` on `deviation:<id>`.
5. **Trace.** Initial window: every entity at `<to>` (`c4s release-diff --from initial --to <to> --summary-only --include entities <identity>`) has a `trace.md` line. Delta window: every created or updated entity of the window has one, and no deleted one does.
6. **Full suite** green under the whole-suite command.

## Output

JSON per `verdict.json`. The loop reopens the unit owning each failed slug (`job:*` reopens every unit its row names; `stub:*` reopens the provider). All covered → the loop marks the brief implemented. Nothing else leaves this run.

## This build

- Identity flags for every `c4s` command: `--project 'app-spec' --workspace 'default'`
- Window: `<from>` = `2.1.7`, `<to>` = `2.1.8`. Brief: `2-1-7-to-2-1-8-workflow-test.md` (you never read it).
- State dir: `.c4s-impl/` in the repo root (the worktree `.worktrees/2-1-7-to-2-1-8`, branch `brief/2-1-7-to-2-1-8`).
- Verifier tools: none.
- Conventions:
- `L7 (File Change Reactions)`: key `pages/layers/L7-file-change-reactions.md`, offset 2 (anchor `6qppsun2`) — read with the `context` form, `--section-limit 1`
- `L13 (Korzenie i rodzaje korzeni)`: key `pages/layers/L13-page-roots.md`, offset 1 (anchor `l13role01`) — read with the `context` form, `--section-limit 1`
- User jobs: none in the specification at `2.1.8`; the system verifier rests on the units' criteria.

### Entity types

`criteria:` lines in a recipe are entities of type `ac`.

| type | role | checks | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | — | — | verifies | status = deprecated |
| mcp-tool | built | — | the tool definition registered in src/server/mcp/*-tools.ts (tool name, input params, description) for the server named in `server` | a contract test in the colocated src/server/mcp/<x>-tools.test.ts whose name carries [entity:<slug>], asserting the tool name and its parameter set | — | — |
| endpoint | built | — | an Express route in src/server/routes/ (method + path) wired into the app | a supertest test in the colocated *.route.test.ts whose name carries [entity:<slug>], asserting method/path and status codes | linkedDtos[].dto | — |
| dto | built | — | the request/response type the route serves (in the route module or src/shared) | the endpoint route test whose name carries [entity:<slug>], asserting the DTO fields on the wire | — | — |
| code-snippet | built | — | the code construct the snippet title names (a type, a template, a construction site) - matched in shape, not verbatim | a trace.md line, plus a test whose name carries [entity:<slug>] where the shape is observable | — | — |

Criterion tests carry the slug as `[ac:<slug>]` in the test name (the repo's existing convention); a `built` entity's shape test carries `[entity:<slug>]`. Tests live next to the code (`src/**/*.test.ts`, `*.route.test.ts`) or under `tests/integration/`.

### Start mode: resume — most of this window is already on the branch

This branch already carries an implementation of the whole window, made in one pass from a delta brief (PR #258). Your job is to make each slug and goal hold, not to rebuild:

- **Find before you write.** For every slug, deletion and goal clause, first look for what already exists (`trace.md`, `grep` for the slug, the identifiers the spec names). Keep what already holds; change only what is missing or wrong against the window. Never rewrite working code to taste.
- A test that already asserts the criterion but lacks the `[ac:<slug>]` tag in its name: add the tag (or split the test) rather than writing a duplicate.
- Code that does something other than the window says, where the spec is silent or ambiguous about it: a `drift` deviation, not a silent change.
- `trace.md` starts empty: add a line for every `built` entity in scope, including counterparts that already existed.

### Tests — overrides every "run the filtered command" / "run the full suite" in the role text above

**Never run tests in this build**: no `vitest`, no `npm test`, no `npm run test:*`, no Playwright, no e2e — not filtered, not single files. The whole suite runs once, at system verification, in an env-runner environment ordered by the orchestrator.

- Implementer: write and update tests, but do not run them. After code changes run `npm run typecheck` (allowed — it is a compile check, not a test) and leave it clean.
- Verifier (unit scope): verification is **static**. Find the test by slug, read its body, judge the assertion: `covered` (found, asserts what the title names), `uncovered` (no test carries the slug), `test-not-verifying` (found, asserts something else or nothing — quote it). Use `test-fails` only when the test, read against the current code, cannot pass (cite the code path that contradicts it). Instead of the full suite at unit scope: run `npm run typecheck`; a failure is `test-fails` against `regression` with its output tail as evidence.
- `release.json` → `build.tests` carries no runnable command on purpose.

### Repo rules

- All user-facing UI and API messages in English; existing code comments may stay Polish.
- Match the surrounding code: naming, comment density, idioms. Read the repo instruction files (`CLAUDE.md`, `AGENTS.md`) if present.
- Do not run Docker or env-runner yourself.
- `c4s` errors: `SERVER_NOT_RUNNING` / `SERVER_NOT_RECOGNIZED` → status `error`; never read specification files by hand.

### Full suite at system scope

You do not run it. Before your run the orchestrator orders the full `npm test` and the e2e suite in an env-runner environment built from this branch and saves the result under `.c4s-impl/runs/system-suite.md` (failing test names with their output tails, plus known pre-existing flakes compared against a `main` environment). Read that file: each failure is `test-fails` against the slug in its name, or against `regression` when it carries none. A failure the file marks as reproduced on `main` is not a row.

### Criteria with an empty `verifies` — overrides "Read problems" in the text above

Many active `ac` criteria in this window have an empty `verifies` field. That is **not** a read problem and **not** blocking — it is already reported as deviation `dev-0001` (do not raise it again). Such a criterion is in scope like any other: in split mode put it in the portion whose layer its title concerns (the latest such layer if several); verify it against its title alone — a test tagged `[ac:<slug>]` asserting what the title names as observable.
