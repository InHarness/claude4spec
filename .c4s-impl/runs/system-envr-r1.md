# System verification — env-runner r1 @ d035bac7 (env `2-1-25-to-2-1-26`, thread fIjgWY6E6r1G, app http://localhost:3300)

- npm test: Test Files 3 failed | 501 passed (504); Tests 3 failed | 6071 passed (6074).
  1. `src/client/components/TagsList.render.test.ts` `[section:xfkinig4] /tags renders each tag through EntityListRow` — `expected [...] to have a length of 1 but got 2` at :64:22 → u05.
  2. `tests/integration/architecture/discovery-core.test.ts` `[ac:ac-registry-l9-jest-wolane-wylacznie-prz] no global serializer registry exists, and no transport reaches the engine` — `expected [Array(1)] to deeply equal []` at :123:7; hit: `src/server/mcp/plan-tools.ts:276: .describe(UPDATE_PLAN_EDITS_DESCRIPTION),` → u13.
  3. `src/server/core/plugin-host/project-host.test.ts` `consolidate — overlay partitions into three disjoint, total, deterministically ordered sets` — `expected { active: ['ac','endpoint'] } to deeply equal { active: ['endpoint','ac'] }` at :101:18 → u04 (type-order change).
- test:e2e: 4 failed | 200 passed | 19 skipped (6 files failed).
  - `entity-version-history.test.ts` `[ac:ac-w-widoku-entityversionhistoryview-wers] groups unassigned versions under the "Unreleased" group at the top` — `expected false to be true` at :188:55, also failing in solo rerun with endpoints present → u02.
  - Known seed (`data: empty`): artifact-threads-panel, plan-footer, entity-version-history beforeAll + empty-state test (`no unversioned entity`).
  - Known flake: editor-l8-contexts `new user root` (pre-existing on main, memory: e2e l8 non-validated root flake).
  - Passed on solo rerun: envelope-entity-pages ×2, frontend-mockups-envelope `/uiview`.
