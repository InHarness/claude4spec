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
- Window: `<from>` = `2.1.17`, `<to>` = `2.1.18` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-17-to-2-1-18` (branch `impl/2-1-17-to-2-1-18`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`) — no end-to-end command, no smoke command; every criterion is proven by a test that runs without the app.
- Tests — **never run any test locally** (no `npm test`, no `vitest`, not even filtered): the whole suite runs once in an env-runner environment at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`); not available to you. Treat "full suite green" as: `npm run typecheck` passes, and no test you can read is broken by the diff (read the tests touching the changed code — host tests under `src/**` and `tests/**`, plugin tests under `plugins/*/test/` and `plugins/*/src/**`, golden/snapshot tests and `e2e/` specs that exercise changed or removed behaviour such as the MCP servers mounted per context type, the `transagent-tools` surface and the M46 one-bubble-per-turn rule — and update them by hand).
  - filtered command (`<pattern>`): static — find the test whose name contains `<pattern>`, read its body, and confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - A verifier status `covered` therefore means: test found, assertion matches, code read through makes it pass, typecheck green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages; never run `npm install` / anything that rewrites the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages in English; code comments may stay as the surrounding code has them.
- UI tests: React components are tested in vitest without the running app — `// @vitest-environment happy-dom` + `createRoot`/`act` (pattern: `src/client/ui/modals/ProjectCreate.render.test.ts`) or `renderToStaticMarkup` (pattern: `src/client/chat/BlockRenderer.transagent.test.ts`). Plugin tests live in `plugins/<plugin>/test/**` (and `plugins/*/src/**/*.test.ts`) and are collected by the root config.
- Published package subpaths are declared in the root `package.json` `exports` (e.g. `./plugin-runtime` → `dist/server/plugin-runtime/index.js` + `dist/plugin-types/…d.ts`); the plugin runtime surface lives in `src/server/plugin-runtime/`, the plugin loader/host in `src/server/core/plugin-host/` (`loader.ts`, `register-builtins.ts`, `overlay-loader.ts`), skills registry/system-prompt blocks in `src/server/services/`.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts (`[entity:<slug>#<key>]` for a per-entity item), `[section:<anchor>]` when the criterion is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** Such a criterion is NOT a read problem and NOT a `clarification` deviation: it checks its own title and description, read against the pages of its unit's recipe. Build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` in this window** is not built: remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **Linked entities a criterion's `verifies` names but the recipe does not** are read at `<to>` as context for the criterion; they are not built counterparts of this unit unless the recipe names them.
- **Windows out of order.** The later window 2.1.18 → 2.1.19 is already implemented in this repo (PR #268), and so is 2.1.16 → 2.1.17 (PR #269); 2.1.17 → 2.1.18 is not. The code may therefore already hold state newer than `<to>`. Never revert or weaken something a later window introduced. Where this window's state at `<to>` contradicts code that already matches a later release, keep the later code, build only what this window adds on top, and record a non-blocking `clarification` deviation naming the conflict.
- **User-jobs convention.** The convention `pages/SKILL.md` offset 12 (`45yst8co`) is a prose section about modules, not a user-jobs table; the modules table is the spreadsheet `moduly-feature` embedded at offset 13 (`oq23nb0j`). No unit owns a user job in this window; the system verifier reads both sections as context for the modules this window touches (M05, M10, M12, M21, M23, M44, M46).

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L15 (Context Types) — implementor `M44` | `pages/layers/L15-context-types.md` | 2 | `6jkqb2h4` |
| L3 (Spec Operations) — implementor `M43` | `pages/layers/L3-spec-operations.md` | 2 | `l3slice0` |
| L3 (Spec Operations) — implementor `M43` | `pages/layers/L3-spec-operations.md` | 3 | `g8adono9` |
| L3 (Spec Operations) — implementor `M43` | `pages/layers/L3-spec-operations.md` | 9 | `vdf5esgb` |
| L5 (UI) — implementor named in section 1 (`42ewy1oy`) | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| User jobs table, for the system verifier | `pages/SKILL.md` | 12 | `45yst8co` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| mcp-tool | built |  |  | the tool registered on its MCP server (`server` field → src/server/mcp/<server>*.ts, e.g. transagent-tools.ts, patch-tools.ts; operation descriptors in src/server/operations/core-operations.ts) with the entity's `name`, `params` (name, type, required), `description`, annotations and `logic` | a vitest test colocated with the server's tools file (src/server/mcp/<x>*.test.ts or surface.test.ts) named with [entity:<slug>] asserting the registered tool's name, input schema (params, required) and hints, and the behaviour its `logic` states |  |  |
| ui-view | built |  |  | the client screen routed at the view url (patch-page: /patches/$ → src/client/components/PatchDetail.tsx, wired in src/client/router.tsx) rendering its default state and every entry of `states`, with the copy and controls its description states | a frontend unit test (vitest + jsdom / RTL, next to the existing client tests) named with [entity:<slug>] rendering the screen in its default state and each listed state and asserting the described controls/copy |  |  |
| module-dependency | context |  |  |  |  |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| katalog-operacji-m46 | built | all data rows (2) | nazwa (the backticked operation name, `spawn_child_turn`) | the `spawn_child_turn` operation descriptor in src/server/operations/core-operations.ts (channels internal=direct, cli/mcp/rest n/a, error codes) and its internal rendering `runTransagent` in src/server/mcp/transagent-tools.ts + the M46 dispatcher, honouring the row's addressing (artifact address from `payload`) and multiplicity (at most one bubble in flight; sequential calls in one turn allowed) | a vitest test named with [entity:katalog-operacji-m46#spawn_child_turn] (src/server/operations/catalog.test.ts or src/server/mcp/transagent-tools.test.ts) asserting the catalog entry (channels, error codes) and the observable addressing and multiplicity |
