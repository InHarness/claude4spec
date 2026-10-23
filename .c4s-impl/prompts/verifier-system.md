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
- Window: `<from>` = `2.1.44`, `<to>` = `2.1.45` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-44-to-2-1-45` (branch `impl/2-1-44-to-2-1-45`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command. Every requirement is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - Whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, the diff breaks no test you can read. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/bin/**` and `tests/**`; plugin tests under `plugins/*/test/`; golden and snapshot tests; `e2e/` specs (they may reference the removed Compare deep link / M25 counter). Update them by hand.
  - Filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - E2e and smoke commands: none.
  - So a verifier status `covered` means four things: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages. `node_modules` in the worktree is a symlink to the main checkout's. It is git-excluded, so never commit or replace it. Never run `npm install` or anything else that rewrites the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI and API messages are in English. Code comments may stay in the language the surrounding code uses.
- UI tests: React components are tested in vitest without the running app. Use `// @vitest-environment happy-dom` with `createRoot`/`act` (pattern: `src/client/components/CreateReleaseDialog.render.test.ts`, `src/client/components/ReleaseDetail.gitsync.render.test.ts`), or `renderToStaticMarkup`. Server tests use vitest + supertest (pattern: `src/server/routes/releases.test.ts`, `src/server/services/release-unreleased-diff.test.ts`).
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - Server (M17 unreleased delta): `src/server/services/release-unreleased-diff*` / `release-operations.ts` / `versions.ts` / `file-version.ts` / `git.ts`, routes `src/server/routes/releases.ts`, MCP `src/server/mcp/release-tools/`.
  - Client: `src/client/lib/releases-api.ts`, `src/client/hooks/useReleases.ts`, live-update events `src/client/ui/events.ts`; screens `src/client/components/ReleasesPage.tsx`, `ReleasesList.tsx`, `ReleasesCompareTab.tsx`, `CreateReleaseDialog.tsx`, `ReleaseDetail.tsx`; M25 banner `src/client/components/release/UnreleasedBanner.tsx`; route + `?tab=compare` search schema in `src/client/router.tsx`.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts (`ui-view`), `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L5 (UI) — moduł implementujący wskazany w sekcji 0 | `pages/layers/L5-ui.md` | 0 | `ew1yz9k3` |
| L5 (UI) | `pages/layers/L5-ui.md` | 1 | `42ewy1oy` |
| L5 (UI) | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| User jobs table (modules), for the system verifier | `pages/SKILL.md` | 12 | `45yst8co` |
| User jobs table (modules), for the system verifier | `pages/SKILL.md` | 13 | `oq23nb0j` |
| User jobs table (modules), for the system verifier | `pages/SKILL.md` | 14 | `zpn3gaip` |

User jobs table: at 2.1.45 the convention's address holds the module index (`moduly-feature`), not a user-jobs table. No unit owns a job. The system verifier works from the units' goals, criteria and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| ui-view | built |  |  | the React screen for /releases (src/client/components/ReleasesPage.tsx with its tabs ReleasesList.tsx / ReleasesCompareTab.tsx, route + search schema in src/client/router.tsx) — url, params, tabs and alternative `states` as the view states, composed from the catalog components it names | a happy-dom render test next to the screen component (src/client/components/ReleasesPage.render.test.ts) named with [entity:releases-list] asserting the composition the view states (tabs, their labels, the states) and the absence of removed parts |  |  |
| module-dependency | context |  |  |  |  |  |  |
