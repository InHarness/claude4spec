# System verification — env-runner run 1 (env `2-1-9-to-2-1-10-workflow`, SHA b1d759d)

npm test: 10 failed / 5199 passed. npm run test:e2e: 3 failed / 204 passed / 19 skipped + 3 suites failed in beforeAll.

- REAL: src/server/services/git-lock.test.ts — `GitRepoLock > run() waits for the holder…` TypeError releaseFirst is not a function (run() awaits acquire before fn). Owner: u1.
- ENV: tests/integration/api/mcp-bridge.test.ts ×9 — needs dist/bin/c4s-mcp.js; pretest builds only envelopes. 9/9 after `npm run build:server`. Not touched by this branch.
- FLAKY: tests/e2e/ac-envelope.test.ts `/ac is offered once…` — 6/6 alone.
- SEED (data: empty): envelope-entity-pages ×2, artifact-threads-panel, entity-version-history, plan-footer — "seed one first".
