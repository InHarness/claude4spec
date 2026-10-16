# System verification — env-runner r1 @ 94c0fb5d (env `2-1-26-to-2-1-27`, thread TSvZC52X6NlP)

- npm test: Test Files 1 failed | 504 passed (505); Tests 1 failed | 6102 passed (6103). npm ci with lockfile.
  - `src/client/hooks/usePlan.list.test.ts` `[section:m10api00] the /plans page list comes from the artifact family route GET /api/artifacts/:kind with :kind=plan, filters passed through as query` — `TypeError: Body is unusable: Body has already been read` at src/client/lib/api-core.ts:40 via fetchJson usePlan.ts:54 / fetchPlanList usePlan.ts:77 / test :36:5 (also fails alone: 1 failed | 2 passed). The mock hands the same Response object to two calls. → u5.
- test:e2e: failed files artifact-threads-panel, entity-version-history, envelope-entity-pages, plan-footer.
  - Known seed (`data: empty`): artifact-threads-panel ("no plan to exercise"), plan-footer ("no plan with a non-empty body"), entity-version-history empty-state test ("no unversioned entity") — same as main r1–r3 of 2.1.25→2.1.26.
  - envelope-entity-pages: passed on solo rerun (known flake).
