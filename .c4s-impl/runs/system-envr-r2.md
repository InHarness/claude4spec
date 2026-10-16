# System verification — env-runner r2 @ ebbe2806 (env `2-1-25-to-2-1-26`, thread fIjgWY6E6r1G)

- npm test: Test Files 1 failed | 503 passed (504); Tests 1 failed | 6073 passed (6074).
  - `src/client/components/TagsList.render.test.ts` `[section:xfkinig4] /tags renders each tag through EntityListRow: the colour dot in leading (no icon), …` — `TypeError: Cannot read properties of undefined (reading 'icon')` at :77:20 (also alone). → u05.
- r1 files alone: discovery-core 16/16 PASS, project-host 17/17 PASS.
- test:e2e: 3 failed | 201 passed | 19 skipped.
  - Passed on solo rerun: ac-envelope `/ac is offered once`, envelope-entity-pages ×2.
  - Known seed (`data: empty`): artifact-threads-panel, plan-footer, entity-version-history empty-state test (`no unversioned entity`). The r1 `Unreleased` test (:188) now PASSES.
  - editor-l8-contexts passed in the full run.
