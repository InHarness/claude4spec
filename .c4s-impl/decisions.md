# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-11)

- Brief: `2-1-12-to-2-1-13-workflow.md` (app-spec / default, 2.1.12 → 2.1.13). 4 units in 3 waves (w1 u1; w2 u2, u4; w3 u3); empty stub ledger.
- Set-up answers reused from the previous run (brief 2-1-11-to-2-1-12), plan approved by the user.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification (`npm ci` from the lockfile, as uid 1000). `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only. `app: none`.
- Red baseline: skipped (no local suite run is possible); the env-runner run at the end is baseline + final check together. Failures claimed "pre-existing" are proven against an env built from `main`. One fix round after the env-runner run is budgeted up front.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged, followed by full cleanup.
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded). `node_modules` in the worktree is a symlink to the main checkout's.
- No user-jobs table in the spec (brief: the system verifier relies on the units' module criteria) → no `units[].jobs`.
- All recipe addresses (page ranges ↔ anchors, entity slugs) were checked against `release-diff` at set-up: all hold.
- Window entries without a unit (brief "Wpisy okna bez jednostki"): M21 §15 and M23 `m23mcp01` only repoint a reference to the explicit-addressing rule; the module-tag change on `brief-tools-get-brief` / `katalog-operacji-m21` — no code.

## Overrides of the skill (lessons from earlier runs)

- An active `ac` with an empty `verifies` is not a read problem / clarification: it checks its own title and description against its unit's pages (written into the implementer/verifier prompts as "Build overrides"). (All criteria in this window do have `verifies`.)
- A unit's FIRST review (`rounds.review == 0`) reads `baseCommit..HEAD`, not `startCommit..HEAD`.

## Entity types (versions checked against `c4s catalog` at set-up)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria (observedIn unit) | verifies | verifies | status = deprecated | 3 |
| mcp-tool | built (tool registration in src/server/mcp/<server>.ts + vitest `[entity:<slug>]`) | | | | 1 |
| spreadsheet | per-entity | | | | 3 |

## Entity parts

- `katalog-operacji-m10` (spreadsheet) — one part: `built`, items: every operation row, key: `nazwa`. Why: each row is an operation registered in the core operation catalog (channels, addressing, rules, error codes) — system structure.
- `katalog-operacji-m21` (spreadsheet) — same classification, for the brief operations.
- u1 split: 1 portion (packet 26 KB); no entities in recipe → criteria are the changed sections bpejzx03, m36bind01, jg79a7q4.

## u1-izolacja-adresowania / p1-l3-l3 (implementer, round 1)

- The `explicit-addressing` rule lives in `src/server/operations/addressing.ts` (M43 is the L3 rule owner): `addressingParamShape(channel, ownerDeclaresIsolation)` → `required` (cli/mcp/rest) | `optional` (internal, default) | `absent` (internal, isolation exception); `addressingParam(name, shape, schema)` renders it into a zod raw shape.
- Owner isolation declarations are a separate table (`OWNER_THREAD_ISOLATION`, keyed by artifact kind, value = citation of the owner's declaration), NOT a field of the M36 `artifactRegistry` entry: M36's matrix only supplies the address (m36bind01), and the existing registry test pins entries to `binding` + `danglingPolicy`. Empty in u1 — u2 adds the M10 plan declaration and wires plan-tools.
- M36 supplies the address through `bindingAddress(kind, thread)` in `artifact-registry.ts` (reads the kind's `binding.threadColumn` off a loaded thread).
- `patch-tools` now renders its `path` through the rule (M23 declares no isolation → optional): no behaviour change. `plan-tools` / `brief-tools` are not wired in u1: plan-tools' internal shape (already no `path`) becomes the rule's `absent` once u2 declares plan isolation; brief-tools is dev-0001.
- Criteria are the changed section anchors; tests are named `[section:<anchor>]` (addressing.test.ts, artifact-registry.test.ts, patch-tools.test.ts). No entities → no trace.md lines.
- Gate 'next window exists' (2-1-13-to-2-1-14-workflow.md pending): user — one brief per PR and merge; finish this window, the next brief runs as its own loop after the merge.

## u2-izolacja-planu / p1-l3-l14 (implementer, round 1)

- M10 declares plan thread isolation in `OWNER_THREAD_ISOLATION.plan` (`src/server/operations/addressing.ts`); `plan-tools` renders every plan `path` through `addressingParam('path', artifactAddressingShape('plan', explicit ? 'mcp' : 'internal'), …)`, so the internal mount has no `path` (absent, not optional) and the threadless mount requires it. u1's tests that pinned the table to `{}` (addressing.test.ts, artifact-registry.test.ts) now pin it to `['plan']`.
- The internal address comes from M36's matrix: `PlanService.getByThread` / `setAppliedByThread` resolve the pinned plan through `bindingAddress('plan', chatService.getThreadMeta(threadId))` (first production caller). `update()` still reads `getThreadPlanPath` (same column; its lock-keying logic is untouched).
- `PlanService.getByAddress(path)` is the externally addressed read: PLAN_NOT_FOUND (with the project's plan list as hint) for an unknown path, via the same `assertAddressedPlan` the write path's `requirePlan` uses. Used by plan-tools' explicit mount (get_plan, version tools), by the REST `get_plan` rendering (`GET /api/artifacts/plan/<path>`, artifacts.ts plan adapter) and by `attachThreadToPlan` (execute_plan's REST rendering). `getByPath` (generic NOT_FOUND) stays for internal callers.
- `setAppliedByThread` keeps one function for both renderings: `path` given (external only) → must exist (PLAN_NOT_FOUND); absent → the pinned plan; none pinned → INVALID_ARGUMENT (dev-0002). The internal tool no longer forwards any `path` key.
- A missing `path` on the explicit mount (handler-level guard, unreachable through the schema) is now INVALID_ARGUMENT instead of VALIDATION — the rows declare no VALIDATION.
- Catalog: `list_plan_versions`, `get_plan_version` and `execute_plan` were not registered; they are now (opClass `plan`, so no profile's reach and no plan-mode list changes — the version tools had no row, which the gate/prompt treated as "no row → not listed", same outcome as class `plan`). `execute_plan` is `human-mediated`, rest-only; no tool renders it. Error code lists of all plan rows aligned to the sheet (update_plan gains IMMUTABLE_FIELD — the rest editor-save rendering — and loses VALIDATION/NOT_FOUND). `mark_plan_applied.rest` is `direct` per the sheet (the PATCH frontmatter route calls the same PlanService function; `update_artifact_frontmatter` is not a catalog row).
- L14: the four removed CLI commands (get/update/list-versions/get-version plan) never existed in `src/bin/c4s/commands/` — only `create-plan`; the change is the catalog `cli` cells (`na` with the sheet's reason) and nothing in the bin.
- Tool descriptions of `get_plan` / `create_plan` on the thread mount are the entities' `description` verbatim; the threadless mount keeps its own wording (there the returned path IS usable, so the isolation sentence does not apply).
- Tests: all in `src/server/mcp/plan-tools.test.ts` (new describe, real PlanService over both mounts); the existing surface.test.ts / tests/integration/db/plans.test.ts cases were adjusted for getByAddress, INVALID_ARGUMENT and the no-`path` internal call.

## u2-izolacja-planu / p1-l3-l14 (implementer, round 2 — rev-0001)

- The plan rows' `rest` cells stay `direct` with [PLAN_NOT_FOUND, INVALID_ARGUMENT]; the routes were brought to the rows, not the rows narrowed. `ArtifactKindAdapter` gained optional `listVersions` / `getVersion`; only the plan adapter implements them (brief/patch keep the generic `file_version` reads with VERSION_NOT_FOUND / VALIDATION — their rows are not in this unit).
- Plan adapter: every addressed REST rendering (versions list, single version, content PUT, frontmatter PATCH) first calls `PlanService.assertAddressedPlan` (now public) → PLAN_NOT_FOUND with the project's plans as hint. A version that is not a positive integer or is past the last one is INVALID_ARGUMENT (same message as the MCP rendering); a non-boolean `applied` on the plan frontmatter PATCH is INVALID_ARGUMENT (was VALIDATION).
- The REST version list keeps its newest-first order (the version-history panel reads it); only the MCP rendering is oldest-first.
- Tests: tests/integration/api/plans.test.ts, describe "plan rows — REST renderings answer with the rows' codes", one `[entity:katalog-operacji-m10#<op>]` case per REST rendering (list_plan_versions, get_plan_version, mark_plan_applied, update_plan).
- rev-0002 (non-blocking) not addressed in this round: only rev-0001 was in scope.
