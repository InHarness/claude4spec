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

- **Identity flags** (append to every `c4s` command, written inline): `--project app-spec --workspace claude4spec-private`
- **Window:** `<from>` = `2.1.87`, `<to>` = `2.1.88`. Brief: `2-1-87-to-2-1-88.md`.
- **Code repo (run everything from here):** `/Users/michael/Code/ctowiec/claude4spec-private/codebase/apps/claude4spec-app/.worktrees/2-1-87-to-2-1-88/codebase/apps/claude4spec-app` — a git worktree on branch `impl/2-1-87-to-2-1-88`. `dist/` is already built; rebuild (`npm run build:server`) only if a test spawns `dist/bin/*` and your change touches it.
- **State dir:** `/Users/michael/Code/ctowiec/claude4spec-private/codebase/apps/claude4spec-app/.worktrees/2-1-87-to-2-1-88/codebase/apps/claude4spec-app/.c4s-impl`
- **Tests:**
  - suite: `npm test`
  - filtered: `npx vitest run -t "<pattern>"` (also `npm run typecheck` after code changes)
  - e2e / smoke: none
- **Running app:** none (`app: none`). A test that needs a server or a process starts what it needs itself (supertest, in-process server, spawned bin) and runs with the filtered command.
- **Verifier tools:** none beyond the repo, the test commands and the `c4s` CLI.
- **Test naming:** a test proving a criterion or an entity carries its slug in its name, e.g. `it('[ac-…] …')` or `it('[entity:<slug>] …')`, so the filtered command finds it.
- **Project rule — `ac` with empty `verifies`:** an active `ac` whose `verifies` is empty is **not** a read problem and not a blocking deviation. Its title is the contract, checked against the unit's page sections. Never ship a patch for it.
- **Language:** the specification is in Polish; code identifiers and comments follow the surrounding code.

### Conventions (layer pages; read with the `context` form, `--section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L15 (Context Types) — implementor M44 | `pages/layers/L15-context-types.md` | 2 | `6jkqb2h4` |
| L16 (System Prompt Contribution) — implementor M48 | `pages/layers/L16-system-prompt-contribution.md` | 2 | `6g3aicw4` |
| L3 (Spec Operations) — implementor M43 | `pages/layers/L3-spec-operations.md` | 2 | `l3slice0` |
| L19 (Project Type Capabilities) — implementor M57 | `pages/layers/L19-project-type-capabilities.md` | 2 | `5r0h4h6i` |
| User jobs table, for the system verifier (embeds the module catalog sheet moduly-feature; no job rows) | `pages/SKILL.md` | 13 | `oq23nb0j` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | per-criterion | — | — | verifies | status = deprecated |
| endpoint | built | — | — | an Express route handler (src/server/routes/ for project-scoped routes) with the endpoint's method, path, status codes and linked request/response/error DTOs | a supertest test (src/server/routes/<name>.route.test.ts or tests/integration/api/) hitting method+path and asserting the status codes and response shape named by the endpoint | linkedDtos | — |
| dto | built | — | — | a TypeScript type in src/shared/ (request/response shape shared by server and client) plus the route's input validation for request DTOs | the route supertest asserts the response body has exactly the DTO's fields (required ones present) and that a request violating a request DTO's field rules is rejected | — | — |
| database-table | built | — | — | the table's DDL as a migration (src/server/db/ migrations of the DB that owns the table) plus its row mapping/accessors in the owning store | a migration/store test asserting the table's columns and that the store writes/reads every column | — | — |
| code-snippet | built | — | — | the snippet's text verbatim in code: system-prompt block templates in src/server/services/system-prompt/ (szablon-*), TypeScript contracts (kontrakt-*) as the exported types/interfaces of the owning module | a unit test next to the block/contract asserting the rendered block equals the snippet's `code` (placeholders filled), or a type-level test asserting the contract's members | — | — |
| ui-view | built | — | — | a React screen component under src/client/ rendering the view's url params, elements and alternative states | a render test src/client/**/<View>.*.render.test.ts(x) asserting the view's elements and each of its `states` | — | — |
| cli-command | built | — | — | a leaf command of the c4s binary: src/bin/c4s/commands/<name>.ts registered in src/bin/c4s/registry.ts, with the record's name, mode, args, flags, input, aliasOf, returns and errorCodes | src/bin/c4s/commands/<name>.test.ts (or registry.test.ts) asserting flag/arg parsing, aliasing, rejected flags and the delegated request | — | — |
| mcp-tool | built | — | — | a tool definition in the owning MCP server src/server/mcp/<server>.ts: name, description, params schema, returns and the read-only/destructive/idempotent/open-world hints, verbatim from the record | the server's src/server/mcp/<server>.test.ts asserting the tool's name, params (required/default) and hints, and its logic | — | — |
| spec-operation | built | — | — | the operation record in src/server/operations/core-operations.ts (name, scope, mediation, internal/cli/mcp/rest channels, effects, idempotency, rules, error codes) and its behaviour in the handler it renders | an `[entity:<slug>]` test in src/server/operations/catalog.test.ts asserting the record's fields, plus a behaviour test of the handler | — | — |
| module-dependency | context | — | — | — | — | — | — |
| spreadsheet | per-entity | — | — | — | — | — | — |

### Entity parts

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| moduly-feature | context | all rows | column `#` (module number) | — | — |
