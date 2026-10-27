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
- Window: `<from>` = `2.1.54`, `<to>` = `2.1.55` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-54-to-2-1-55` (branch `impl/2-1-54-to-2-1-55`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/bin/**` and `tests/**`; plugin tests under `plugins/*/test/` (incl. fixture corpora); golden and snapshot tests; `e2e/` specs; `tests/ac-skiplist.json`. Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages. Never run `npm install` or anything else that rewrites the lockfile; if `node_modules` is missing in the worktree, symlink it from the main checkout (`ln -s ../../node_modules node_modules`) and never commit it.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- UI tests: React components are tested in vitest without the running app. Use `// @vitest-environment happy-dom` with `createRoot`/`act` (pattern: `src/client/components/ReleaseDetail.gitsync.render.test.ts`, `src/client/components/settings/SettingsPage.render.test.ts`), or `renderToStaticMarkup`. Server tests use vitest + supertest (pattern: `src/server/routes/config.route.test.ts`, `src/server/routes/git.test.ts`).
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - M25 release push (u1): `src/server/services/release-push.ts`, `src/server/routes/release-pushes.ts` (+ test), `src/server/routes/remote-project.ts` (+ test), `src/server/services/remote-http-client.ts`, `remote-settings-fields.ts`, `src/shared/release-push.ts`, `src/shared/remote-project.ts`; client `src/client/components/release/{push-to-remote-action.tsx,ReleasePushesList.tsx,RemoteProjectElement.tsx}`, `src/client/hooks/{useReleasePushes,useRemoteProject}.ts`, `src/client/lib/release-pushes-api.ts`, `ReleaseDetail.unreleased-banner.render.test.ts`, `useReleases.ts` (pushed badge), settings registry/catalog; spec-operations in `src/server/operations/core-operations.ts` + `tests/helpers/spec-operation-records.ts`; migrations `031_release_push.sql`, `032_*`; config `remoteProjectId` in `src/server/config.ts`; M24 `src/server/services/remote-auth.ts`, `src/client/components/account/UserCardElement.tsx`.
  - M27 clone (u2): `src/server/services/release-import.ts` (+ tests), `src/shared/release-import.ts`, `src/server/workspace/project-context.ts`, `src/bin/claude4spec.ts`, `src/bin/launch.ts`, `src/bin/gitignore.ts` (created/found report), migration `034_release_import.sql`.
  - M17 bundle (u3): `src/server/services/release-bundle.ts` (+ tests), `release.ts`, `release-clone-roots.test.ts`, `release-file-roots.test.ts`, `release-root-rename.test.ts`, snapshot route in `src/server/routes/releases.ts`.
  - M28/M17 push on release (u4): `src/server/services/git.ts` (+ test), `src/shared/git.ts`, `src/server/routes/git.ts`, `src/server/services/release.ts` / `release-create-transaction.test.ts`, config `syncPushOnPush` in `src/server/config.ts` / `src/server/routes/config.ts`, client `ReleaseDetail` + GitErrorRecoveryModal.
  - New migrations start at `059_*.sql` under `src/server/db/migrations/`; also check `000_baseline.sql` and the database-tables plugin fixture corpus (`plugins/c4s-plugin-database-tables/test/fixtures/corpus/app-spec/`).
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts, `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L1 (DB) | pages/layers/L1-db.md | 3 | l1schema |
| L4 (API) | pages/layers/L4-api.md | 2 | pondhd6o |
| L5 (UI) | pages/layers/L5-ui.md | 2 | tehej2wz |
| L13 (Korzenie i rodzaje korzeni) | pages/layers/L13-page-roots.md | 2 | l13slice0 |
| L14 (CLI Commands) | pages/layers/L14-cli-commands.md | 1 | flt0hm9r |
| L17 (Project Settings) | pages/layers/L17-project-settings.md | 2 | ata1r5sz |
| Tabela modułów (zadania użytkownika), dla weryfikatora systemu | pages/SKILL.md | 13 | oq23nb0j |

The `Tabela modułów (zadania użytkownika)` convention embeds only the `moduly-feature` module index, not a user-jobs table. No unit owns a job. The system verifier works from the units' goals, criteria and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| endpoint | built |  |  | the Express route (method + path) in the owning module's route file under src/server/routes/ answering the linked DTOs at their status codes; an endpoint deleted in the window (/api/release-pushes*, /api/remote-project) means its route file, its mount and its client calls are gone; an updated one (git/status, git/branches, releases/:nameOrId/snapshot, remote-account) answers as the record states | a supertest test next to the route (src/server/routes/<area>*.test.ts) named with [entity:<slug>] asserting method+path answer with the documented statuses/bodies and linked DTO shapes — for a deleted endpoint, that method+path is no longer served (404) | linkedDtos |  |
| dto | built |  |  | the TypeScript type (src/shared/** or the route file) of the payload, plus its client mirror in src/client/lib/api.ts — field names, types and required/optional/nullability exactly as the DTO's `fields`; a DTO deleted in the window has no type left in code | a supertest or vitest test next to the owning route/service named with [entity:<slug>] asserting the live payload/accepted body has every field with its type and no removed field (for a deleted DTO: the payload that carried it no longer exists / the field is absent) |  |  |
| database-table | built |  |  | a SQL migration under src/server/db/migrations/ (next number, 059_*.sql onward) bringing the schema to the record — a deleted table (release_push, release_import) is dropped; an updated one (remote_session, file_version) has the record's columns (name, type, nullability, default) — plus the matching row/type mapping in the code that reads and writes it | a vitest migration test (src/server/db/<name>.migration.test.ts, pattern of file-version-root-ids.migration.test.ts) named with [entity:<slug>] asserting PRAGMA table_info has the record's columns, or that a deleted table is absent after migrating |  |  |
| spec-operation | built |  |  | the operation declaration in the L3 catalog (src/server/operations/core-operations.ts, types in catalog.ts) with its channel cells and error codes; a deleted operation (push-release, list-release-pushes, get-release-push) is no longer declared and no channel serves it | a vitest test in src/server/operations/catalog.test.ts named with [entity:<slug>] asserting the declaration matches the record, or is absent for a deleted operation |  |  |
| code-snippet | built |  |  | config-json-shape → the shape of the project's config.json as the config loader/schema (src/server/config.ts) parses and writes it; git-service-contract → the GitService public API (src/server/services/git*); release-service-contract → the release service public API (M17, src/server/services/release*) — shape-matched, not verbatim | a trace.md line plus a vitest test next to the loader/service named with [entity:<slug>] asserting the snippet's shape (members present, removed members absent) |  |  |
| ui-view | built |  |  | the React view component for the record (release-detail → the release detail page under src/client/components/**) — url, params, states and composition as the view states | a happy-dom render test next to the component named with [entity:<slug>] asserting the composition the view describes and the absence of removed parts |  |  |
| module-dependency | context |  |  |  |  |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts (per-entity types)

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| flagi-cli-m01 | built | the row whose Flag is `--clone <slug>` (removed in the window), and the list of implying flags in the Opis of the row whose Flag is `--create-project` | Flag | the CLI flag parsing in src/bin/claude4spec.ts / src/bin/launch.ts: the flag is no longer accepted and no longer implies --create-project | a vitest test in src/bin/launch.test.ts named with [entity:flagi-cli-m01#<Flag>] asserting the parser rejects/ignores --clone and that it is not in the implying-flags set |
| flagi-cli-m01 | context | all other rows | Flag |  |  |
| moduly-feature | context | all |  |  |  |
| sub-drzewo-m17 | context | all |  |  |  |
| sub-drzewo-m25 | context | all |  |  |  |
| sub-drzewo-m27 | context | all |  |  |  |

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **An entity deleted in this window** (`op: delete`) is built as an absence: the code no longer has what the entity described. A test that asserted it is removed or rewritten.
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something, no fallback, alias or dead code path survives, and no test asserts the old behaviour any more.
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly (circular imports hidden by `main.tsx`), happy-dom limits (selectors, layout), React SSR attribute order when matching markup with regexes, async/microtask timing (await the query/refetch the assertion depends on), background work outliving the test (vitest "Unhandled Errors", timers must be cleared or faked).
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, cache invalidation wider than what actually changed, full re-reads where a narrower read suffices, recomputation on the server — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
