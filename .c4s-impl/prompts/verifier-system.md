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
- Window: `<from>` = `2.1.58`, `<to>` = `2.1.60` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-58-to-2-1-60` (branch `impl/2-1-58-to-2-1-60`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/core/**`, `src/bin/**` and `tests/**` (notably `tests/helpers/test-app.ts`, which builds apps/contexts for many suites); plugin tests under `plugins/*/test/`; golden and snapshot tests; `e2e/` specs and their global setup (the server now listens before contexts are built — readiness waits in e2e helpers must still hold); `tests/ac-skiplist.json`. Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- The worktree already has `node_modules` and built `dist/` (envelopes + server). Never run `npm install`/`npm ci` or anything else that rewrites the lockfile. Adding or removing a dependency (e.g. dropping `chokidar`) is a `decisions.md` entry plus a `package.json` edit; say so in your report so the orchestrator refreshes the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- Server tests use vitest + supertest (pattern: `src/server/routes/config.route.test.ts`); workspace/context tests live next to `src/server/workspace/*` (patterns: `context-cache.test.ts`, `lazy-activation.test.ts`, `bootstrap.activation.test.ts`). Timing-sensitive tests (debounce, queue order, error window ~15 s, file stabilisation) use fake timers or injected clocks/hooks — never real sleeps of seconds.
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - File watching, M40 (U1): `src/server/fs/watcher.ts`, `src/server/fs/watch-ignore.ts`, `src/server/fs/record-store.ts`, `src/server/workspace/root-registry-runtime.ts` (mounts), other `chokidar` users (`src/server/services/brief.ts`, `src/server/services/release.ts`, `src/core/references/types.ts`, `tests/helpers/test-app.ts`).
  - Indexing, M29 (U2): `src/server/services/entity-indexer.ts` (`indexAll`), its callers in `src/server/workspace/project-context.ts`, `src/server/core/plugin-host/project-host.ts`, `src/server/db/projection.ts`, other indexers (`release-indexer.ts`, `pages-frontmatter-indexer.ts`).
  - Project init, M01 (U3, U4a): `src/server/workspace/bootstrap.ts`, `db-migration.ts`, `plan-migration.ts`, `peer-config.ts`, `slot-marker.ts`, `advisory-lock.ts`, `src/server/config.ts`.
  - Context lifecycle / build queue, M31 (U4a, U4b, U6): `src/server/workspace/context-cache.ts` (today LRU `maxLive` / `C4S_MAX_LIVE_PROJECTS` — removed), `project-context.ts`, `middleware.ts`, `routes.ts`, `list-projects.ts`, `registry.ts`, `home-workspace.ts`, `core-reactions.ts`, server entry `src/server/index.ts` (`app.listen()`), start `src/bin/launch.ts`; SQLite slots M41 under `src/server/db/` (`index.ts`); spec skills M52 `src/server/workspace/project-skills.ts`.
  - Invalidation triggers (U5): `PATCH /api/config` in `src/server/routes/config.ts` / `config-rename.ts` (`config.entities`), plugin pool reload in `src/server/core/plugin-host/` (`loader.ts`, `base-packages.ts`, `project-host.ts`, `cross-cutting.ts`), trust `src/server/workspace/trust-plugins.ts` (`setProjectTrust`).
  - External MCP, M12 (U6): `src/server/mcp/http-mount.ts` (today references `maxLive` / lazy rebuild after eviction), `src/server/mcp/surface.ts` (`tools/list_changed`).
  - Measurements (U7): a measurement script under `scripts/` (or a vitest bench-style test that is skipped by default) producing FD count and memory per cycle; its result goes into the implementation report (`.c4s-impl/decisions.md` → measurement section). It is run at system verification in the env-runner environment.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L10 (Project Scoping) — implementor M31 | pages/layers/L10-project-scoping.md | 2 | l10slice0 |

There is no user-jobs table at `2.1.60` (the brief says the `pages/SKILL.md` index has none). No unit owns a job. The system verifier works from the units' goals and criteria.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| module-dependency | context |  |  |  |  |  |  |

A criterion (`ac`) that a changed page embeds or that points at an entity of the unit is read and proven like any criterion, even when no recipe line names it.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something (`maxLive`, `C4S_MAX_LIVE_PROJECTS`, LRU eviction, chokidar with `awaitWriteFinish` and its 80 ms / 20 ms constants, lazy one-time indexing, lazy rebuild on `tools/call` after eviction), no fallback, alias or dead code path survives, and no test asserts the old behaviour any more.
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly, async/microtask timing (await the build/queue promise the assertion depends on), background work outliving the test (background build queue, watchers, timers must be stopped/closed in `afterEach`, otherwise vitest "Unhandled Errors" or hanging workers), tests touching `~/.claude4spec` must use a temp HOME / registry dir, real filesystem watchers need temp dirs and must be closed.
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, cache invalidation wider than what actually changed, full re-reads where a narrower read suffices, recomputation on the server, blocking the event loop — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
