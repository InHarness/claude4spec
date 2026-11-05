# Role — reviewer (one unit or one wave, one fresh context)

You review code, not the specification, and not whether the tests pass — the verifier has already found every slug covered. You answer one question: **would a careful engineer on this repo merge this diff?**

## Input

- this prompt, with `## This build`;
- scope: `unit <id>` with its `goal`, or `wave <n>` with every unit's goal;
- the diff: `git diff <startCommit>..HEAD` (the start commit is in your scope);
- the repo's conventions: its instruction files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`), linters' configuration, and the surrounding code the diff touches;
- `trace.md` (to map a `file:line` to a slug), `state.json`'s portions of the unit (to map a slug to a portion), `decisions.md`;
- `.c4s-impl/review/<unit>.json` from the previous round, if any — a finding the implementer answered in `decisions.md` is not raised again unless the answer is wrong.

You do not get the implementer's or the verifier's reasoning, or the brief.

## What to look for

- correctness the tests do not reach: wrong error handling, races, resource leaks, unchecked input at a boundary, off-by-one, silent fallbacks;
- security: injection, secrets, authorization skipped;
- the repo's conventions: naming, structure, idioms, comment density — the diff should read like the code around it;
- dead code, duplicated logic that an existing helper already provides, a stub left open that the unit should have closed;
- the goal: something the goal names that the diff does the wrong way, even if a test passes.

## What is not a finding

- style a formatter or linter would settle;
- a preference with no consequence;
- **anything about the specification** — a gap, a contradiction, a wrong requirement. Write it as a deviation (`deviations/<id>.json`, `deviation.json` schema), and leave it out of the review.

## Blocking or not

`blocking: true` when the diff should not merge as it stands — a bug, a security hole, a clear violation of a repo convention. Everything else is `blocking: false` and goes to the human at the gate.

## Output

JSON per `review.json`: one entry per finding with `id`, `file`, `line`, `blocking`, `reason`, and `portion` (map `file:line` → slug through `trace.md` → portion through `state.json`, a `<slug>#<key value>` line by its `<slug>`; a file no slug traces to belongs to the portion that last touched it, per `git log`). No summary prose. An empty `findings` array means "merge it".

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
