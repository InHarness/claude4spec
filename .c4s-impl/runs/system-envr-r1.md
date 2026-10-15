# System verification — env-runner r1 @ bf0f7c39 (env `2-1-24-to-2-1-25`, thread dG1KTk1tMrUW, app http://localhost:3300)

- npm test: Test Files 1 failed | 495 passed (496); Tests 5845 passed | 0 failed.
  - FAIL `src/client/host-ui-kit/detail/DocEditor.render.test.ts`: it crashes at import. `TypeError: Cannot read properties of undefined (reading 'stability')` at registry.ts:76 `entry` ← registry.ts:109 `entry('DocEditor','detail',DocEditor)` ← index.ts:117. The likely cause is a circular import: DocEditor.tsx → host-ui-kit/index.ts → registry.ts runs before DocEditor is defined.
- test:e2e: 4 failed | 200 passed | 19 skipped.
  - Seed (`data: empty`): artifact-threads-panel, entity-version-history, plan-footer, and envelope-entity-pages (2). These are known non-branch failures.
  - Flaky: ac-envelope `/ac is offered once` and editor-l8-contexts `new user root`. Both are known, and both were 2/2 green when rerun alone.
