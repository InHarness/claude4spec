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
- Window: `<from>` = `2.1.26`, `<to>` = `2.1.27` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-26-to-2-1-27` (branch `impl/2-1-26-to-2-1-27`). Work only there.
- State dir: `.c4s-impl/` in that worktree. Packets go to `.c4s-impl/packets/` (gitignored).
- Running app: none (`app: none`). There is no end-to-end command and no smoke command, so every criterion is proven by a test that runs without the app.
- Tests: **never run any test locally**. That means no `npm test` and no `vitest`, not even filtered. The whole suite runs once, in an env-runner environment, at system verification.
  - whole-suite command: env-runner only (`npm test` + `npm run test:e2e`), not available to you. "Full suite green" therefore means two things. First, `npm run typecheck` passes. Second, no test you can read is broken by the diff. Read the tests that touch the changed code: host tests under `src/client/**`, `src/server/**`, `src/bin/**` and `tests/**`; plugin tests under `plugins/*/test/`; golden/snapshot tests (e.g. `src/plugin-types/published-surface.test.ts`, `src/plugin-types/ambient-legs.test.ts`, `src/server/mcp/surface.test.ts`); and `e2e/` specs. Update them by hand.
  - filtered command (`<pattern>`): static. Find the test whose name contains `<pattern>` and read its body. Confirm it asserts what is required and would pass against the code as written. `npm run typecheck` is the only command you run.
  - e2e / smoke commands: none.
  - So a verifier status `covered` means: the test was found, its assertion matches, reading the code through shows it passes, and typecheck is green.
- A fresh worktree may need `npm run build:envelopes && npm run build:server` before `npm run typecheck` resolves workspace packages. `node_modules` in the worktree is a symlink to the main checkout's; it is git-excluded, so never commit or replace it. Never run `npm install` or anything else that rewrites the lockfile.
- Verifier tools: none.
- Repo conventions: read `CLAUDE.md` in the repo root. User-visible UI/API messages are in English. Code comments may stay in the language the surrounding code uses.
- UI tests: React components and client modules are tested in vitest without the running app, using `// @vitest-environment happy-dom` + `createRoot`/`act` (pattern: `src/client/ui/modals/ProjectCreate.render.test.ts`) or `renderToStaticMarkup`. Plugin tests live in `plugins/<plugin>/test/**` and the root config collects them.
- Where this window's code lives (starting points; find every other reader with grep before renaming or removing anything):
  - L3 operation catalog: `src/server/operations/` — `catalog.ts`, `core-operations.ts` (registered rows), `error-codes.ts`; tests in `catalog.test.ts`.
  - u1 M02 page writes: `src/server/services/page-write.ts`, `src/server/services/pages.ts`, `src/server/routes/pages.ts`, `src/server/mcp/page-tools.ts` (+ `page-tools.facade-roots.test.ts`); M06 section batch: grep `update_sections`/`updateSections`.
  - u2 M13 type tools: `src/server/plugin-runtime/create-mcp-server.ts` (`{type}-tools` server), `src/server/core/plugin-host/entities-router.ts` (REST proxy + DTO link routes), `src/server/workspace/project-context.ts`, `src/server/mcp/entity-tools.ts`, external surface `src/server/mcp/http-mount.ts` / `mcp-config.ts` / golden `surface.test.ts`; field content: `src/server/discovery/ops/content.ts`.
  - u3 external reader: `src/server/mcp/c4s-reader.ts` (+ test), internal renderings in `src/server/mcp/reference-tools.ts`.
  - u4 M21 briefs: `src/server/routes/briefs.ts`, `src/server/mcp/brief-tools.ts`, the brief service (grep `createBrief`), initial-thread creation (grep the thread service).
  - u5 M10 plans: `src/server/services/plan.ts`, `src/server/mcp/plan-tools.ts`, `src/server/routes/artifacts.ts` (generic artifact-kind list), `src/server/discovery/pagination.ts`; client plans page: grep in `src/client/**`.
  - u6 M30 static: `src/server/routes/static.ts`, `src/server/services/static-html.ts`.
- Test names carry the slug: `[entity:<slug>]` for built counterparts (`spec-operation`, `mcp-tool`, `endpoint`), `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **An entity deleted in this window** (`op: delete`) is built as an absence: the code no longer has what the entity described. A test that asserted it is removed or rewritten.
- **`spec-operation` ↔ `mcp-tool`.** A `spec-operation` record's `narzedzia[]` names, per `internal`/`mcp` channel with value `direct`, the `mcp-tool` slug that renders it. When the recipe names both, build them together: the catalog declaration (spec-operation) and the registered tool (mcp-tool). When the recipe names only the operation, read the named mcp-tool at `<to>` as context; it is not a built counterpart of this unit.
- **A re-rendered `mcp-tool` whose record did not change in substance** still has its `[entity:<slug>]` test: if one exists and still holds, it is covered; otherwise write it.
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **Recorded debt stays debt.** Where a page records a divergence from the host pattern as debt and the unit's goal says it is not fixed here, do not fix it; make sure the code matches the recorded state.
- **Removal without alias is binding.** When the goal says something is removed (an error code, a param, a public hook, a field), no re-export, deprecated alias or shim survives anywhere in the host, the published types, or the plugins in this repo.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`; the M43 differential-mode contract spans offsets 15–17, the L3 record form 3–5)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L3 (Spec Operations) — implementor M43 | `pages/modules/m43-spec-operations-core.md` | 24 | `k0ddfllq` |
| L3 — kontrakt trybu różnicowego (M43) | `pages/modules/m43-spec-operations-core.md` | 15 | `z4m9jx20` |
| L3 — forma rekordu operacji | `pages/layers/L3-spec-operations.md` | 3 | `g8adono9` |
| L4 (API) — bez nazwanego implementora | `pages/layers/L4-api.md` | 2 | `pondhd6o` |

User jobs table: none at 2.1.27. No unit owns a job; the system verifier works from the units' goals and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| spec-operation | built |  |  | the operation's declaration in the L3 operation catalog (src/server/operations/catalog.ts types, rows registered in src/server/operations/core-operations.ts): canonical name = `nazwa`, scope (`zasieg`), mediation, the four channel cells (direct / via / na with reason, `poza katalogiem`), sideEffects (`efekty`), idempotence, errorCodes (`kodyBledow`), contentInput (`opisTresci`), and the internal/mcp `direct` rendering naming the tool in `narzedzia`; `zachowanie` is the behaviour the owning core function implements | a vitest test in src/server/operations/catalog.test.ts (or next to the owning module's core) named with [entity:<slug>] asserting the registered declaration matches the record's fields (name, scope, channels, idempotence, error codes, contentInput, the mcp-tool each internal/mcp direct cell names), plus a behaviour test of the core function for each refusal / rule `zachowanie` states |  |  |
| mcp-tool | built |  |  | the tool registered on its MCP server (slug prefix → src/server/mcp/<server>*.ts, e.g. reference-tools.ts, entity-tools; the external c4s-reader server for c4s-reader-*), its input schema derived from the operation declaration in src/server/operations/core-operations.ts: the entity's `name`, `params` (name, type, required, default), `description`, annotation hints (an empty hint = the server declares nothing, not false) and the behaviour `logic` states; `returns` describes the payload | a vitest test colocated with the server's tools file (src/server/mcp/<server>*.test.ts, or the c4s-reader server's test) named with [entity:<slug>] asserting the registered tool's name, input schema (params, required), declared hints, and the behaviour its `logic` states |  |  |
| endpoint | built |  |  | the Express route (method + path) in the owning module's routes, with its declared request/response/error DTOs (route schema / OpenAPI declaration) per `linkedDtos` and the behaviour `description` states | a supertest test next to the route named with [entity:<slug>] asserting method+path answer with the documented statuses/bodies/headers and that the route declares the linked DTOs | linkedDtos |  |

No `per-entity` types → no entity parts. No `ac` entities in this window: a unit's `Goal:` and its pages are the requirements; prove each stated behaviour (refusal, header, order, channel mount) with a test named `[entity:<slug>]` or `[section:<anchor>]`.
