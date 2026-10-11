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
- Window: `<from>` = `2.1.12`, `<to>` = `2.1.13` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-12-to-2-1-13-workflow` (branch `impl/2-1-12-to-2-1-13-workflow`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`) — no end-to-end command, no smoke command; every criterion is proven by a test that runs without the app.
- Tests — **never run any test locally** (no `npm test`, no `vitest`, not even filtered): the whole suite runs once in an env-runner environment at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`); not available to you. Treat "full suite green" as: `npm run typecheck` passes, and no test you can read is broken by the diff (read the tests touching the changed code — including golden/snapshot tests such as `system-prompt.golden.test.ts` and `surface.test.ts`, whose fixtures must be updated by hand to match).
  - filtered command (`<pattern>`): static — find the test whose name contains `<pattern>`, read its body, and confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - A verifier status `covered` therefore means: test found, assertion matches, code read through makes it pass, typecheck green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages; `node_modules` is a symlink to the main checkout's (never run `npm install` / anything that rewrites the lockfile).
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages in English; code comments may stay as the surrounding code has them.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[entity:<slug>#<key>]` for items of a built part.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** In this specification many active `ac` entities have an empty `verifies`. Such a criterion is NOT a read problem and NOT a `clarification` deviation: it checks its own title and description, read against the pages of its unit's recipe. Build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **Spec-only reference changes.** In this window M21 §15 (`01ytpznn`) and M23 (`m23mcp01`) changed only to repoint a reference to the explicit-addressing rule, and `brief-tools-get-brief` / `katalog-operacji-m21` also changed their module tag; those edits need no code.
- **Linked mcp-tool entities a criterion's `verifies` names but the recipe does not** (e.g. `brief-tools-update-brief`) are read at `<to>` as context for the criterion; they are not built counterparts of this unit unless the recipe names them.

### Conventions (read at `<to>` with `--from initial`, `--section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L3 (Spec Operations) — implementor M43 | `pages/layers/L3-spec-operations.md` | 2 | `l3slice0` |
| L3 (Spec Operations) — deklaracja rodziny odczytu artefaktu | `pages/layers/L3-spec-operations.md` | 9 | `vdf5esgb` |
| L16 (System Prompt Contribution) — implementor M48 | `pages/layers/L16-system-prompt-contribution.md` | 2 | `6g3aicw4` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| mcp-tool | built |  |  | the tool registered on its MCP server (`server` field → src/server/mcp/<server>.ts, e.g. plan-tools.ts, brief-tools.ts) with the entity's `name`, `params` (name, type, required — per channel, as the operation catalog derives them), `description`, annotations (readOnly/destructive/idempotent/openWorld hints) and `logic` | a vitest test in src/server/mcp/<server>.test.ts (or surface.test.ts) named with [entity:<slug>] asserting the registered tool's name, input schema (params, required) and hints, and the behaviour its `logic` states |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| katalog-operacji-m10 | built | every operation row (rows 2..n under the header row) | nazwa (the operation name in backticks, e.g. `get_plan`) | the plan operation descriptors in the core operation catalog (src/server/operations/core-operations.ts and profiles.ts) plus the channel renderings (MCP plan-tools, CLI commands, REST routes) the cells declare | a vitest test in src/server/operations/catalog.test.ts (or the module's *-tools.test.ts) named with [entity:katalog-operacji-m10#<operation>] asserting the row's channel cells (internal/cli/mcp/rest), addressing (params per channel), rules and error codes against the registered operation |
| katalog-operacji-m21 | built | every operation row (rows 2..n under the header row) | nazwa (the operation name in backticks, e.g. `get_plan`) | the brief operation descriptors in the core operation catalog (src/server/operations/core-operations.ts and profiles.ts) plus the channel renderings (MCP brief-tools, CLI commands, REST routes) the cells declare | a vitest test in src/server/operations/catalog.test.ts (or the module's *-tools.test.ts) named with [entity:katalog-operacji-m21#<operation>] asserting the row's channel cells (internal/cli/mcp/rest), addressing (params per channel), rules and error codes against the registered operation |
