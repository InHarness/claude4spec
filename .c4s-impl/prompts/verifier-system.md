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
- Window: `<from>` = `2.1.11`, `<to>` = `2.1.12` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-11-to-2-1-12` (branch `impl/2-1-11-to-2-1-12`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`) — no end-to-end command, no smoke command; every criterion is proven by a test that runs without the app.
- Tests — **never run any test locally** (no `npm test`, no `vitest`, not even filtered): the whole suite runs once in an env-runner environment at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`); not available to you. Treat "full suite green" as: `npm run typecheck` passes, and no test you can read is broken by the diff (read the tests touching the changed code).
  - filtered command (`<pattern>`): static — find the test whose name contains `<pattern>`, read its body, and confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - A verifier status `covered` therefore means: test found, assertion matches, code read through makes it pass, typecheck green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages; `node_modules` is symlinked from the main checkout if missing (do not run `npm install` that rewrites the lockfile).
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages in English; code comments may stay as the surrounding code has them.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** In this specification most active `ac` entities have an empty `verifies`. Such a criterion is NOT a read problem and NOT a `clarification` deviation: it checks its own title and description, read against the pages of its unit's recipe. Build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **UI criteria** (client behaviour: modals, confirmation flows, toasts, navigation after an action, in-modal validation errors) are proven by frontend unit tests (vitest + jsdom / React Testing Library, alongside the existing client tests), not by end-to-end tests.
- **Spec-only reference changes.** Pages of this window other than `pages/modules/m31-workspace.md` changed only to repoint references from M31 decision numbers to sections; they are not in any unit and need no code.

### Conventions (read at `<to>` with `--from initial`, `--section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L5 (UI) — implementor not named on the layer page | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| L10 (Project Scoping) — implementor not named on the layer page | `pages/layers/L10-project-scoping.md` | 2 | `l10slice0` |
| L14 (CLI Commands) — implementor M11 | `pages/layers/L14-cli-commands.md` | 1 | `flt0hm9r` |
| Tabela modułów (zakres każdego modułu), dla weryfikatora systemowego — no user-jobs table exists | `pages/SKILL.md` | 13 | `oq23nb0j` |

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| ui-view | built |  |  | a client screen routed at the view's url (welcome-page: `src/client/components/onboarding/WelcomePage.tsx` at `/welcome`, wired in `src/client/router.tsx`) rendering its default state and every entry of `states` | a frontend unit test (vitest + jsdom / RTL, next to the existing client tests) named with [entity:<slug>] rendering the screen in its default state and in each listed state |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| moduly-feature | context | all |  |  |  |
