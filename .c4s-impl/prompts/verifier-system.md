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
- Window: `<from>` = `2.1.45`, `<to>` = `2.1.46` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-45-to-2-1-46` (branch `impl/2-1-45-to-2-1-46`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/bin/**` and `tests/**`; plugin tests under `plugins/*/test/`; golden and snapshot tests; `e2e/` specs. Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages. Never run `npm install` or anything else that rewrites the lockfile; if `node_modules` is missing in the worktree, symlink it from the main checkout (`ln -s ../../node_modules node_modules`) and never commit it.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- Git tests: the git service is tested against real temporary repos created in the test (pattern: `src/server/services/git.test.ts`, `src/server/services/release-diff-git.test.ts`, `src/server/routes/git-sync.test.ts`). Shadow refs, remotes and conflicts are built the same way — a bare remote + clones in a tmp dir.
- UI tests: React components are tested in vitest without the running app. Use `// @vitest-environment happy-dom` with `createRoot`/`act` (pattern: `src/client/components/ReleasesPage.render.test.ts`, `src/client/components/GitStatusBadge.render.test.ts`), or `renderToStaticMarkup`. Server tests use vitest + supertest (pattern: `src/server/routes/releases.test.ts`, `src/server/routes/git.test.ts`).
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - Server M28: git service `src/server/services/git.ts` (release-marker resolution, fetch/sync, existing `merge-tree --write-tree` use in sync), git lock `git-lock`, routes `src/server/routes/git.ts`, shared types `src/shared/git.ts`.
  - Server M17: `src/server/services/release.ts` (git-anchored release diff), `release-operations.ts`, `release-unreleased-diff*`, routes `src/server/routes/releases.ts`, operation catalog `src/server/operations/catalog.ts` + `core-operations.ts`.
  - Client: header git/branch UI `src/client/components/GitStatusBadge.tsx`, `src/client/lib/git-api.ts`, `git-ws.ts`, live-update events `src/client/ui/events.ts`; releases screen `src/client/components/ReleasesPage.tsx`, `ReleasesList.tsx`, `ReleasesCompareTab.tsx`, `src/client/lib/releases-api.ts`, `src/client/hooks/useReleases.ts`; route + search schema in `src/client/router.tsx`.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts (`endpoint`, `dto`, `spec-operation`, `ui-view`, `tech-stack#Git`), `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 2 | `l3slice0` |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 3 |  |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 4 |  |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 5 |  |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 6 |  |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 7 |  |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 8 |  |
| L3 (Spec Operations), implementor not stated | `pages/layers/L3-spec-operations.md` | 9 | `vdf5esgb` |
| L4 (API), implementor not stated | `pages/layers/L4-api.md` | 2 | `pondhd6o` |
| L5 (UI), implementor not stated | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| User jobs table, for the system verifier (embeds spreadsheet moduly-feature) | `pages/SKILL.md` | 13 | `oq23nb0j` |

User jobs table: at 2.1.46 the convention's address holds the module index (`moduly-feature`), not a user-jobs table. No unit owns a job. The system verifier works from the units' goals, criteria and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| endpoint | built |  |  | the Express route (method + path) in the owning module's routes (M28: src/server/routes/git.ts for /api/git/shadows; M17: its own shadow-diff route module under its own prefix), answering the linked response/error DTOs at their status codes and the behaviour `description` states | a supertest test next to the route (src/server/routes/<area>*.test.ts) named with [entity:<slug>] asserting method+path answer with the documented statuses/bodies and the linked DTO shapes | linkedDtos |  |
| dto | built |  |  | the TypeScript type (src/shared/** or the route/service module) of the payload the carrying route returns — field names, types and required/optional/nullability exactly as the DTO's `fields` | a vitest/supertest test next to the carrying route named with [entity:<slug>] asserting the live payload has every required field with its type and no removed field |  |  |
| spec-operation | built |  |  | the operation's declaration in the L3 operation catalog (src/server/operations/catalog.ts types, rows registered in src/server/operations/core-operations.ts): canonical name, scope, mediation, channel cells, side effects, idempotence, error codes; the behaviour it states is what the owning core function (M17 shadow-diff service) implements | a vitest test in src/server/operations/catalog.test.ts (or next to the owning core) named with [entity:<slug>] asserting the registered declaration matches the record's fields, plus a behaviour test of the core function for each refusal / rule it states |  |  |
| ui-view | built |  |  | the React screen for /releases (src/client/components/ReleasesPage.tsx with its tabs ReleasesList.tsx / ReleasesCompareTab.tsx and the new Shadows tab; route + search schema in src/client/router.tsx) — url, params, tabs and alternative `states` as the view states, composed from the catalog components it names | a happy-dom render test next to the screen component (src/client/components/ReleasesPage.render.test.ts or a sibling) named with [entity:releases-list] asserting the composition the view states (tabs, their labels, the states) |  |  |
| module-dependency | context |  |  |  |  |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts (per-entity types)

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| tech-stack | built | the row whose Warstwa is **Git** (row 17) | Warstwa | git version / capability detection in the M28 git service (src/server/services/git.ts): try-merge requires git ≥ 2.38 (`merge-tree --write-tree`); on older git it reports 'not supported' (consumers fall back to shadow-only) | a vitest test next to the git service (src/server/services/git.test.ts) named with [entity:tech-stack#Git] asserting the version gate (≥ 2.38 supported, older reported unsupported) |
| tech-stack | context | all rows except Git (rows 2–16) |  |  |  |
