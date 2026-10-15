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
- Window: `<from>` = `2.1.20`, `<to>` = `2.1.21` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-20-to-2-1-21` (branch `impl/2-1-20-to-2-1-21`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`) — no end-to-end command, no smoke command; every criterion is proven by a test that runs without the app.
- Tests — **never run any test locally** (no `npm test`, no `vitest`, not even filtered): the whole suite runs once in an env-runner environment at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`); not available to you. Treat "full suite green" as: `npm run typecheck` passes, and no test you can read is broken by the diff (read the tests touching the changed code — host tests under `src/client/**`, `src/server/**` and `tests/**`, plugin tests under `plugins/*/test/`, golden/snapshot tests and `e2e/` specs that exercise removed behaviour of this window, such as plugin settings cards on the settings page (`plugin-<name>` anchors), plugin-contributed fields in the settings field/element registry, the per-plugin `plugins` key in `.claude4spec/config.json` / `AppConfigResponse` / `PatchConfigRequest`, the `settings` slot of the plugin package envelope and the host's settings list — and update them by hand).
  - filtered command (`<pattern>`): static — find the test whose name contains `<pattern>`, read its body, and confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - A verifier status `covered` therefore means: test found, assertion matches, code read through makes it pass, typecheck green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages; `node_modules` in the worktree is a symlink to the main checkout's (git-excluded; never commit or replace it). Never run `npm install` / anything that rewrites the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages in English; code comments may stay as the surrounding code has them.
- UI tests: React components and client modules are tested in vitest without the running app — `// @vitest-environment happy-dom` + `createRoot`/`act` (pattern: `src/client/ui/modals/ProjectCreate.render.test.ts`) or `renderToStaticMarkup`. Plugin tests live in `plugins/<plugin>/test/**` and are collected by the root config.
- Plugin settings before this window (what this window removes): server settings registry `src/server/settings/registry.ts` (+ `field-registry.test.ts`), plugin host `src/server/core/plugin-host/{types,registry,entity-settings-fields}.ts` (+ `capabilities.test.ts`, `__fixtures__/plugins.ts`), shared envelope `src/shared/plugin-host/manifest.ts`, config `src/server/config.ts`, `src/server/routes/config.ts` (+ `config.route.test.ts`), `src/server/workspace/project-context.ts`, client `src/client/core/plugin-host/pluginSettings.ts`, `src/client/components/settings/SettingsPage.tsx`, `src/client/lib/api.ts`. Find every other reader with grep before deleting.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[section:<anchor>]` when the criterion is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** Such a criterion is NOT a read problem and NOT a `clarification` deviation: it checks its own title and description, read against the pages of its unit's recipe. Build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` in this window** is not built: remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **An entity deleted in this window** (`op: delete`, e.g. a `module-dependency`) is built as an absence: the code no longer has what the entity described (here: M26 no longer imports from the M13 plugin host for settings); a test that asserted it is removed or rewritten.
- **Linked entities a criterion's `verifies` names but the recipe does not** are read at `<to>` as context for the criterion; they are not built counterparts of this unit unless the recipe names them.
- **Recorded debt stays debt.** Where a page records a divergence from the host pattern as debt and the unit's goal says it is not fixed here, do not fix it; make sure the code matches the recorded state.
- **`not yet` is binding.** A part of a read the scope marks as deferred to a later unit is not built in this unit, even when it would be easy — the later unit builds it.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L17 (Project Settings) — implementor M26 | `pages/layers/L17-project-settings.md` | 2 | `ata1r5sz` |
| L11 (Plugin Runtime Surface) — implementor M33 | `pages/layers/L11-plugin-runtime-surface.md` | 2 | `l11slice0` |
| Tabela modułów (user jobs) | `pages/SKILL.md` | 12 | `45yst8co` |
| Tabela modułów (user jobs) | `pages/SKILL.md` | 13 | `oq23nb0j` |

User jobs table: the addressed sections hold the `moduly-feature` modules spreadsheet, not who/what/success rows — no unit owns a job; the system verifier works from the units' `ac` criteria.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| dto | built |  |  | the TypeScript type (src/shared/** or the config route module) of the payload the carrying route returns/accepts — field names, types and required/optional exactly as the DTO's `fields`; a field removed in the window (per-plugin settings) is gone | a vitest/supertest test next to the carrying route (src/server/routes/config.route.test.ts) named with [entity:<slug>] asserting the live payload has every required field with its type and no removed field |  |  |
| ui-view | built |  |  | the React page component (src/client/components/settings/SettingsPage.tsx and the settings card registry it mounts) — url, params, states and composition as the view states; no generated plugin cards (`plugin-<name>` anchors) | a happy-dom render test next to the component named with [entity:settings-page] asserting the page composition the view describes and the absence of removed parts |  |  |
| code-snippet | built |  |  | the shape the snippet shows — for config-json-shape the `.claude4spec/config.json` envelope (scaffold/schema of top-level keys in src/server/config.ts and the settings registry) | a vitest test next to src/server/config.ts named with [entity:<slug>] asserting the scaffolded/accepted top-level keys equal the snippet's and a removed key (`plugins`) is neither scaffolded nor reserved |  |  |
| module-dependency | context |  |  |  |  |  |  |

No `per-entity` types → no entity parts.
