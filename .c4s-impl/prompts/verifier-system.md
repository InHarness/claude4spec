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
- Window: `<from>` = `2.1.47`, `<to>` = `2.1.48` (delta window).
- Repo: the git worktree `/Users/michael/Code/ctowiec/claude4spec/.worktrees/2-1-47-to-2-1-48` (branch `impl/2-1-47-to-2-1-48`). Work only there.
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
- UI tests: React components are tested in vitest without the running app. Use `// @vitest-environment happy-dom` with `createRoot`/`act` (pattern: `src/client/components/PlanPage.render.test.ts`, `src/client/components/PatchDetail.render.test.ts`), or `renderToStaticMarkup`. Server tests use vitest + supertest (pattern: `src/server/routes/artifacts.test.ts`). MCP tool declarations and behaviour: `src/server/mcp/brief-tools.test.ts`, `patch-tools.test.ts`, `plan-tools.test.ts`. CLI: `src/bin/c4s/commands/brief-patch-commands.test.ts`.
- Where this window's code lives. These are starting points: grep for every other reader before renaming or removing anything.
  - M36 (chat artifacts): route family `src/server/routes/artifacts.ts` (detail `GET /api/artifacts/:kind/*path`); shared read core `src/server/services/artifact-read.ts` (`ArtifactRange`, windowing/budget), `artifact-content.ts`, `artifact-registry.ts`; kind services `brief.ts`, `patch.ts`, `plan.ts`; DTOs in `src/shared/entities.ts` (`ArtifactResponse`).
  - Operations: `src/server/mcp/brief-tools.ts` (get_brief), `patch-tools.ts` (get_patch), `plan-tools.ts` (get_plan); L3 catalog `src/server/operations/catalog.ts` + `core-operations.ts` (channel cells; patch's former indirect rest cell through the old generic read).
  - CLI (M11): `src/bin/c4s/commands/get-brief.ts`, registration in `src/bin/c4s.ts`, HTTP helper `src/core/agent/http.ts`.
  - Client: briefs `src/client/components/BriefDetail.tsx`, `BriefEditor.tsx`, `src/client/lib/briefs-api.ts`; patches `PatchDetail.tsx`, `PatchEditor.tsx`, `src/client/lib/patches-api.ts`; plans `PlanPage.tsx`, `PlanEditor.tsx`, `src/client/hooks/usePlan.ts`; route schema in `src/client/router.tsx`.
- Test names carry the slug: `[ac:<slug>]` for criteria, `[entity:<slug>]` for built counterparts (`endpoint`, `spec-operation`, `ui-view`, entity parts), `[entity:cli-command/get-brief]` for the CLI command (its slug collides with the spec-operation `get-brief`), `[section:<anchor>]` when the requirement is a changed section.
- Never commit; the orchestrator commits. Never run `git stash`.

### Conventions (read at `<to>` with `--from initial`, `--section-offset <offset> --section-limit 1`)

| label | key | offset | anchor |
| --- | --- | --- | --- |
| L3 (Spec Operations) — implementor M43 — role of the layer | `pages/layers/L3-spec-operations.md` | 1 | `kehuh3fj` |
| L3 (Spec Operations) — implementor M43 — module slice schema | `pages/layers/L3-spec-operations.md` | 2 | `l3slice0` |
| L4 (API) — implementor M49 | `pages/layers/L4-api.md` | 2 | `pondhd6o` |
| L5 (UI) — implementor M50 | `pages/layers/L5-ui.md` | 2 | `tehej2wz` |
| L14 (CLI Commands) — implementor M11 | `pages/layers/L14-cli-commands.md` | 1 | `flt0hm9r` |

User jobs table: at `2.1.48` the specification has none (the index `pages/SKILL.md` holds no such table). No unit owns a job. The system verifier works from the units' goals, criteria and built entities.

### Entity types

| type | role | checks | observedIn | inCode | verify | links | inactive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | unit |  |  | verifies | status = deprecated |
| endpoint | built |  |  | the Express route GET /api/artifacts/:kind/*path in src/server/routes/artifacts.ts: the default (editor) projection returns the whole file with no budget/window/truncation; view=operation renders the get_<kind> operation read (line window `range`, response budget, explicit degradation); an unknown view or a window without view=operation is refused as an argument error — answering the linked DTOs at their status codes | a supertest test in src/server/routes/artifacts.test.ts named with [entity:get-api-artifacts-kind-path] asserting both projections, the refusals and the linked DTO shapes | linkedDtos |  |
| spec-operation | built |  |  | the operation declarations get_brief / get_patch / get_plan in the L3 catalog (src/server/operations/core-operations.ts, types in catalog.ts): channel cells (rest → the artifact detail route with view=operation; patch gets a direct rest cell instead of the former generic read), error codes; the truncation over the response budget they state is implemented in the shared artifact-read core (brief/patch/plan tools) | a vitest test next to the owning tools (src/server/mcp/brief-tools.test.ts / patch tools / plan-tools.test.ts) or src/server/operations/catalog.test.ts named with [entity:<slug>] asserting the registered declaration matches the record, plus a behaviour test of truncation + truncationHint |  |  |
| cli-command | built |  |  | the leaf command `c4s get-brief` in src/bin/c4s/commands/get-brief.ts (registered in src/bin/c4s.ts): own flags/args as the record lists, delegating to GET /api/artifacts/brief/<path>?view=operation[&range=]; it computes no budget, cuts nothing and validates no window, and passes truncated + truncationHint through | a vitest test in src/bin/c4s/commands/brief-patch-commands.test.ts named with [entity:cli-command/get-brief] (slug collides with spec-operation get-brief) asserting the request it sends, its flags and the passed-through truncation fields |  |  |
| ui-view | built |  |  | the React screens /briefs/$ (src/client/components/BriefDetail.tsx + BriefEditor.tsx), /patches/$ (PatchDetail.tsx + PatchEditor.tsx), /plans/:slug (PlanPage.tsx + PlanEditor.tsx), loading the whole file from the default projection of the artifact detail route, with the view's `states` | a happy-dom render test next to the screen component (BriefDetail.render.test.ts, PatchDetail.render.test.ts, PlanPage.render.test.ts) named with [entity:<slug>] asserting the composition and states the view lists |  |  |
| spreadsheet | per-entity |  |  |  |  |  |  |

### Entity parts (per-entity types)

| slug | role | items | key | inCode | verify |
| --- | --- | --- | --- | --- | --- |
| wklad-do-edytora-m10 | built | row 2 (`plan`), columns Rodzaj, Nazwa, Trigger / miejsce | Nazwa | <PlanEditor /> embedded as the artifact panel of the plan detail route /plans/:slug (src/client/components/PlanPage.tsx), in the main window beside the Threads and Version history panels | a happy-dom render test in src/client/components/PlanPage.render.test.ts named with [entity:wklad-do-edytora-m10] asserting PlanEditor renders on /plans/:slug beside Threads and Version history |
| wklad-do-edytora-m10 | criteria | row 2 (`plan`), column „Zapis / tryb”: always editable (no read-only mode); Save visible only when dirty and saves the whole content; each save makes a new file_version; Discard reverts to the last saved version; a hash conflict (409) shows an inline banner whose only action is „Reload” — no „Override”, the file is not overwritten | Nazwa |  |  |

### Build overrides (these replace the rules above them where they differ)

- **Criterion with an empty `verifies`.** This is NOT a read problem and NOT a `clarification` deviation. The criterion checks its own title and description, read against the pages of its unit's recipe; build and verify it like any other criterion. Raise a deviation only when the title itself is ambiguous or contradicts the pages.
- **A criterion that became `deprecated` or was deleted in this window** is not built. Remove or rewrite the existing test carrying its `[ac:<slug>]` so nothing asserts the retired behaviour, and make the code match the pages at `<to>`.
- **An entity deleted in this window** (`op: delete`) is built as an absence: the code no longer has what the entity described. A test that asserted it is removed or rewritten.
- **Linked entities named by a criterion's `verifies` but not by the recipe** are read at `<to>` as context for the criterion. They are not built counterparts of this unit unless the recipe names them.
- **`not yet` is binding.** A part of a read that the scope marks as deferred to a later unit is not built in this unit, even when it would be easy; the later unit builds it.
- **Removal without alias is binding.** When a goal or a changed section removes or replaces something, no fallback, alias or dead code path survives, and no test asserts the old behaviour any more.
- **"Whole file" is proven past the budget.** Every claim that a projection or a screen loads the whole file is tested with a body longer than the response budget, asserting the last line is present (and, for a save, that the saved content still ends with it). A test with a short body does not prove it.
- **A refused save leaves the file alone.** The plan's hash-conflict (409) path is tested by asserting the file on disk is byte-identical after the refusal, and that the banner offers only „Reload”.
- **Static verification is weak — compensate.** Tests never run locally, so read a test through as its runner would: module evaluation order for any module a new test imports directly (circular imports hidden by `main.tsx`), happy-dom limits (selectors, layout), React SSR attribute order when matching markup with regexes, async/microtask timing (await the query/refetch the assertion depends on), background work outliving the test (vitest "Unhandled Errors", timers must be cleared or faked).
- **Unused code is always removed.** When a change leaves code without callers (a route, a service method, a helper, a type, a test that only exercises it), delete it in the same unit. Dead code left behind is a **blocking** review finding.
- **Performance is always optimized.** Needless refetches, full re-reads where a window suffices on the operation path, recomputation on the server, cache invalidation wider than what actually changed — fix them in the same unit. A performance problem is a **blocking** review finding, never "efficiency only".
