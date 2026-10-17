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
- Window: `<from>` = `2.1.27`, `<to>` = `2.1.28` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-27-to-2-1-28` (branch `impl/2-1-27-to-2-1-28`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command, so every criterion is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, no test you can read is broken by the diff. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/bin/**` and `tests/**`; plugin tests under `plugins/*/test/`; golden/snapshot tests (e.g. `src/plugin-types/published-surface.test.ts`, `src/plugin-types/ambient-legs.test.ts`, `src/server/mcp/surface.test.ts`, `src/server/plugin-runtime/l11-surfaces.test.ts`); and `e2e/` specs. Update them by hand.
  - filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - So a verifier status `covered` means: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages. `node_modules` in the worktree is a symlink to the main checkout's; it is git-excluded, so never commit or replace it. Never run `npm install` or anything else that rewrites the lockfile. A new plugin package under `plugins/` must not need new npm dependencies (reuse what the root and sibling plugins already have); if it truly needs one, record a blocking `clarification` deviation instead of installing.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages are in English. Code comments may stay in the language the surrounding code uses.
- UI tests: React components and client modules are tested in vitest without the running app, using `// @vitest-environment happy-dom` + `createRoot`/`act` (pattern: `src/client/ui/modals/ProjectCreate.render.test.ts`, `src/client/host-ui-kit/overlay/Dialog.render.test.ts`) or `renderToStaticMarkup`. Plugin tests live in `plugins/<plugin>/test/**` and the root config collects them.
- Where this window's code lives (starting points; find every other reader with grep before renaming or removing anything):
  - Host UI kit catalog (M34/L12): `src/client/host-ui-kit/` — `registry.ts` (+ `registry.test.ts`, entries with `stability`, `binding`, `l11Surfaces`), `stability.ts`, `index.ts`, `one-implementation.test.ts`, per-group dirs `core/ list/ actions/ form/ overlay/ overlay-feedback/ detail/ pickers/`; the React-free stable list `src/shared/plugin-host/ui-kit-surface.ts` (`UI_KIT_STABLE_COMPONENTS`), version surface `src/shared/plugin-host/host-api.ts`; the `/ui` entry for plugins `src/server/plugin-runtime/ui.ts`, `src/plugin-types/ui.ts`.
  - L11 runtime surface (M33): `src/shared/plugin-host/runtime-legs.ts`, `src/client/runtime/plugin-runtime.ts`, `src/plugin-types/plugin-runtime.ts`, `src/server/plugin-runtime/l11-surfaces.test.ts`, published types golden `src/plugin-types/published-surface.test.ts`.
  - Editor bridge (M20/M05/M13): `src/client/runtime/editor-bridge.ts`, `src/client/tiptap/EditorContext.tsx`, `src/client/chat/XmlChipDispatcher.tsx`, `src/client/xml-markup/renders.ts`, chip components (`src/client/components/PageRefChip.tsx`, `SectionRefChip*.tsx`, entity chips — grep).
  - Plugins in this repo: `plugins/c4s-plugin-*` (diagram, code-snippets, spreadsheets, database-tables, frontend-mockups for ui-view, ac, api-contracts, …); a new package goes next to them, modelled on the closest sibling that contributes an entity type with its own MCP tools server (e.g. `plugins/c4s-plugin-ac`, `plugins/c4s-plugin-api-contracts`). Builtin envelopes are built by `npm run build:envelopes` — check how siblings are registered there and in the workspace config.
  - Host screens: `src/client/components/` (plans: `PlanPage.tsx`, `PlansListPage.tsx`, `FileVersionHistory.tsx`; trust gate: `TrustPluginsModal.tsx`; tags: `TagsList.tsx`; home empty state: grep `home-redirect`/`EmptyState`).
- Test names carry the slug: `[entity:<slug>]` for built counterparts (`ui-kit-component`, `ui-view`, `dto`), `[entity:<slug>#<key value>]` for a built item of a per-entity part, `[ac:<slug>]` for criteria, `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages and the `ui-kit-component` records of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **An entity or page deleted in this window** (`op: delete`) is built as an absence: the code no longer has what it described. A test that asserted it is removed or rewritten. A deleted spec page (e.g. the `modules/m34-host-ui-kit/` subpages) removes nothing in code beyond references to its path (comments, `file://` links, doc pointers), which are repointed to the page that took over its content.
- **`ui-kit-component` records are the contract.** The record (`props`, `types`, `group`, `stability`, `binding`, `dataSources`, `composes`, `behavior`) is the single source for a component; the page prose speaks only of the catalog as a whole. Where the code and the record differ, the code follows the record, unless the change would alter what a user observes beyond what the unit's goal names — then it is a `drift` deviation, not a silent change. Changing the `props` of a `stable` component without a Host API changelog/`hostApiVersion` entry is a defect.
- **Linked entities named by a criterion's `verifies` or a record's `composes` but not by the recipe** are read at `<to>` as context. They are not built counterparts of this unit unless the recipe names them.
- **Recorded debt stays debt.** Where a page records a divergence from the catalog as debt and the unit's goal says it is not rebuilt in this window, do not rebuild it; make sure the code matches the recorded state.
- **Removal without alias is binding.** When the goal says something is removed or confined (e.g. the editor-bridge hook used only inside the host), no re-export, deprecated alias or shim survives in the published types, the `/ui` or runtime surface, or the plugins in this repo.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L12 (Host UI Kit) — implementor M34 | `pages/modules/m34-host-ui-kit.md` | 10 | `m34l12sc` |
| L12 — schemat wycinka modułu | `pages/layers/L12-host-ui-kit.md` | 2 | `l12slice0` |
| L11 (Plugin Runtime Surface) — implementor M33 | `pages/modules/m33-plugin-loader/m33-plugin-loader.md` | 18 | `m33l11sc` |
| User jobs table, for the system verifier | `pages/SKILL.md` | 13 | `oq23nb0j` |

User jobs table: the convention's address at 2.1.28 holds the module index (`moduly-feature`), not a user-jobs table. No unit owns a job; the system verifier works from the units' goals, criteria and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| ui-kit-component | built |  |  | the catalog component exported from @c4s/plugin-runtime/ui (src/client/host-ui-kit/<group>/…, re-exported via src/client/host-ui-kit/index.ts and src/plugin-types/ui.ts) plus its entry in the catalog registry src/client/host-ui-kit/registry.ts: `name`, `group`, `stability`, `binding`, `l11Surfaces` = the record's `dataSources` (fetchedByComponent for connected), `composes`; its props/types exactly as the record's `props`/`types`; behaviour as `behavior` states; a `stable` one also in UI_KIT_STABLE_COMPONENTS (src/shared/plugin-host/ui-kit-surface.ts) | a vitest test in src/client/host-ui-kit/registry.test.ts named with [entity:<slug>] asserting the registry entry matches the record (group, stability, binding, L11 surfaces, composes), plus a happy-dom render test colocated with the component (<Component>.render.test.ts) named with [entity:<slug>] for the props and the behaviour `behavior` states | composes |  |
| ui-view | built |  |  | the React screen component that renders the view (route per `url`, params, alternative `states`), composed from the catalog components the view names (src/client/components/** for host screens, plugins/<pkg>/frontend/** for plugin-contributed screens) | a happy-dom render test next to the screen component named with [entity:<slug>] asserting the composition the view states (which catalog components render, the states) and the absence of replaced bespoke parts |  |  |
| dto | built |  |  | the TypeScript type TagListItem (M18, src/shared/** / the tags route) — field names, types and nullability exactly as the DTO's `fields`, assignable without a cast to the /ui Tag type and to the TagPicker input | a vitest test next to the tags route / type named with [entity:tag-list-item] asserting the live payload has every field with its type, plus a type-level assignability check (expectTypeOf, checked by npm run typecheck) to the /ui Tag and the TagPicker item |  |  |
| module-dependency | context |  |  |  |  |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts (type `spreadsheet`, per-entity)

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| moduly-feature | context | all |  |  |  |
| warstwy | context | all |  |  |  |
| sub-drzewo-m34 | context | all |  |  |  |
| encje-pluginy | built | the row whose Pakiet is **c4s-plugin-host-ui-kit-components** | Pakiet | the plugin package plugins/c4s-plugin-host-ui-kit-components (envelope contributing entity type `ui-kit-component`, as the row's Zakres states) | a vitest test in the package named with [entity:encje-pluginy#c4s-plugin-host-ui-kit-components] asserting the package manifest declares the `ui-kit-component` type |
| encje-pluginy | context | all other rows |  |  |  |
| wklad-do-edytora-entity-database-table | built | rows 2–3 (each contribution) | Nazwa | the contribution registered by plugins/c4s-plugin-database-tables (contributes.commands `/database-table`; the `database-table-create` popover drawn by the package, not by the kit Dialog) | the package's manifest/popover tests (plugins/c4s-plugin-database-tables/**.test.ts) named with [entity:wklad-do-edytora-entity-database-table#<Nazwa>] asserting the command and the popover discriminator |
