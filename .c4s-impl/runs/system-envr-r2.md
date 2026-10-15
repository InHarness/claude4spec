# System verification — env-runner r2 @ 6eb8b9d9 (code = 78b6a57f; env `2-1-24-to-2-1-25`, thread dG1KTk1tMrUW)

- targeted: DocEditor.render.test.ts 2/2, ElementList.render.test.ts 3/3. The r1 import crash is fixed.
- npm test: Test Files 496/496 passed; Tests 5847/5847 passed.
- test:e2e: 3 failed | 201 passed | 19 skipped.
  - Known seed failures (`data: empty`): artifact-threads-panel, entity-version-history, plan-footer, and envelope-entity-pages ×2.
  - Flaky: frontend-mockups-envelope `/uiview is offered once` (slash menu timing, same as `/ac` in r1; it also failed in impl-2-1-20-to-2-1-21). Rerun alone 2×, it was 6/6 green both times.
  - The r1 flakes (ac-envelope /ac, editor-l8-contexts) passed in this full run.
- Static system verifier: 18/18 covered (runs/verdict-system-static.json).
