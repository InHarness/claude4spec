# System verification — env-runner run 1 (impl-2-1-13 @ 0e1df81, thread OrPJon3voJPS)

- clone/npm ci (lockfile, uid 1000)/build:envelopes/build:server/playwright: all exit 0.
- npm test: 441 files, 5319/5319 passed, 0 failed (all new u1–u4 tests included).
- test:e2e: 41 files, 5 failed (6 tests), 208 passed, 19 skipped.
  - "seed one first" (empty seed, environment has no plan/endpoint): artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages ×2 — same set as the 2.1.12 run, proven identical on main then.
  - frontend-mockups-envelope › "/uiview is offered once…": slash menu has 0 rows. The branch touches no client code; solo reruns + main comparison ordered.

## Re-runs (2026-10-11)

- frontend-mockups-envelope solo ×3 on impl-2-1-13 @ 0e1df81: 6/6, 6/6, 6/6 passed → order/interference flake of the full e2e run, not a branch regression; no main env needed (operator logs: logs/impl-2-1-13/solo3-frontend-mockups-envelope-{1,2,3}.log).
- The 5 "seed one first" tests are environment preconditions (empty seed has no plan/endpoint), not behaviour; the same set failed identically on main in the 2.1.12 run.

## System verifier (2026-10-11): 46/46 rows covered (9 ac, 7 section criteria, 3 mcp-tool, 14 catalog rows, 4 goals, 6 deviations sent, regression); stubs empty.
