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
- Window: `<from>` = `2.1.62`, `<to>` = `2.1.63` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-62-to-2-1-63` (branch `impl/2-1-62-to-2-1-63`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/shared/**`, `src/core/**`, `src/bin/**` and `tests/**` (notably `tests/helpers/test-app.ts`); plugin tests under `plugins/*/test/`; golden and snapshot tests (`__goldens__/`, `__snapshots__/` — update them by hand to what the code now produces); `e2e/` and `tests/e2e/` specs; `tests/ac-skiplist.json`. Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- The worktree has its own `node_modules` (npm ci). Never run `npm install`/`npm ci` or anything else that rewrites the lockfile. Adding, removing or moving a dependency (this window: drop `mermaid`, move `happy-dom` to `devDependencies`) is a `decisions.md` entry plus a `package.json` edit; say so in your report so the orchestrator refreshes the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- Criteria tests: every criterion (`ac`) created or changed in the window has a test tagged `[ac:<slug>]`. Tests of criteria **deleted** in the window (the `diagram` type) disappear from the host — they belong to the plugin repo; delete them, do not port them, and remove their rows from `tests/ac-skiplist.json`.
- Prebuilt envelope: the window's precondition is a committed prebuilt `0.1.0` of plugin `diagrams` at `plugins/c4s-plugin-diagram/` (`package.json` + `dist/`, no `*.map`), produced outside this repo by the plugin's deploy script. Never write, rebuild or edit files inside `plugins/c4s-plugin-diagram/` — read them only (manifest, entry points, contributed types/tools). The host does not build it; it copies its ready `dist/`.
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - Diagram type in the host (diagram-out — removed): `src/server/entities/diagram/` (plugin, serializer, validate, mcp-server, system-prompt, upgrades + tests), `src/shared/entities/diagram/`, `src/client/entities/diagram/`, diagram types in `src/shared/entities.ts`, `src/server/core/plugin-host/register-builtins.ts`, `src/server/entities/index.ts`, `src/server/services/system-prompt/blocks/` (`m13-entities.ts`, `m48-own.ts`, templates), `src/server/db/migrations/040_diagram.sql` (stays; comment fixed), `tests/e2e/diagram-label-color.test.ts`; goldens/snapshots naming diagram (`src/server/serialization/__goldens__/`, `src/server/services/__snapshots__/`).
  - Plugin loader / base tier / pool (diagram-out, type-state-shadowed): `src/server/core/plugin-host/` (`loader.ts`, `base-packages.ts`, `project-host.ts`, `manifest-adapter.ts`, `register-builtins.ts`), `src/server/routes/plugins*.ts` (`_meta/plugins`), `src/shared/plugin-host/` (`types.ts`, `host-api.ts`), trust `src/server/workspace/trust-plugins.ts`.
  - Build and distribution (diagram-out, prebuilt-distribution): `package.json` (`scripts.build:envelopes`, `prebuild`, `pretest`, `files`), `.gitignore`, `docker/Dockerfile`.
  - Container (container-env): `docker/Dockerfile`, `docker/entrypoint.sh` and the other `docker/*.sh`, server CLI flags in `src/bin/` (`--public-url`, `--remote-url`, port).
  - Embedded lists, consistency and chips (list-info-block, card-caption-callback): `src/server/discovery/ops/consistency.ts`, `src/client/entities/ChipResolver.tsx`, the list renderers of `element_list` / `tagged_list` in the editor and in chat/markdown pipelines, `packages/plugin-runtime` (or wherever `@c4s/plugin-runtime` is defined — grep), Host API changelog.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L11 (Plugin Runtime Surface) — implementor M33 | pages/modules/m33-plugin-loader/m33-plugin-loader.md | 18 | m33l11sc |
| L1 (DB) typów encji — tabele generowane ze schematu typu, łańcuch migracji hosta trzyma tylko tabele hosta | pages/modules/m13-entity-framework/m13-entity-framework.md | 3 | m13db000 |
| System verifier goal — M13 Cel | pages/modules/m13-entity-framework/m13-entity-framework.md | 1 | m13cel00 |
| System verifier goal — M19 Cel | pages/modules/m19-references.md | 1 | m19cel00 |
| System verifier goal — M01 Cel | pages/modules/m01-project.md | 1 | 85hp4f2v |

There is no user-jobs table at `2.1.63`. No unit owns a job. The system verifier works from the units' goals, their criteria and the three `Cel` sections above.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| code-snippet | built |  |  | the prompt-template text the host renders for this form (system-prompt block builders); deleted in this window → the host no longer renders it (the envelope contributes it) | a vitest asserting the composed system prompt contains — or, for a deleted snippet, the host alone no longer contains — the snippet's form |  |  |
| database-table | built |  |  | a table generated from the entity type's schema (M13 L1); for `diagram` the host migration chain keeps only host tables, `040_diagram.sql` stays with a corrected comment | a vitest over the generated schema / migration chain (crud-schema-gen, migration/baseline-tables tests) |  |  |
| mcp-tool | built |  |  | an MCP tool definition registered by the host or by an envelope's MCP server; deleted here → removed from host code (`diagram-tools` comes from the prebuilt envelope) | a vitest over the host's registered MCP tools / server catalog (no host-side `validate_diagram`) |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| encje-pluginy | built | row whose Pakiet column is **c4s-plugin-diagram** (row 7) | Pakiet | the committed prebuilt envelope `plugins/c4s-plugin-diagram/` copied to `dist/plugins/<name>` by the build and loaded as the base tier; no direct registration of `diagram` in host code | a vitest asserting the base pool loads `diagram` from the prebuilt envelope (not from direct registration) and that host code no longer registers it |
| encje-pluginy | context | every other row (rows 2–6, 8–12) |  |  |  |
| wklad-do-edytora-entity-diagram | built | all |  | removal of the host's diagram editor contributions (`runDiagram` slash, `DiagramPopover`, `DiagramFullscreen`, diagram hooks, `diagram-expand` window) | typecheck plus a test/grep-level check that no host module exports or registers these contributions |

A criterion (`ac`) that a changed page embeds or that points at an entity of the unit is read and proven like any criterion, even when no recipe line names it.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion, snippet, table, tool or sheet that was deleted (or became `deprecated`) in this window** is not built. Remove the host counterpart and every test carrying its `[ac:<slug>]` / `[entity:<slug>]`, so nothing in the host asserts the retired behaviour; a deleted entity is `covered` when its counterpart and tests are gone from the host (and, where the goal says so, it is provided by the prebuilt envelope instead).
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something (the host's diagram modules, `registerDiagram`, `mermaid`, last-wins `Map.set`, workspace-selection flags in the container), no fallback, alias or dead code path survives, and no test asserts the old behaviour any more.
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly, async/microtask timing, background work outliving the test (watchers, timers, servers closed in `afterEach`), tests touching `~/.claude4spec` use a temp HOME / registry dir. Shell scripts (entrypoint) are tested by vitest spawning them with a stub server binary / env, never by Docker.
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, cache invalidation wider than what actually changed, full re-reads where a narrower read suffices, blocking the event loop — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
