# System verification — env-runner run 1 (impl-2-1-12 @ 165301e, thread wMaAzDvyfU21)

- npm ci (lockfile, uid 1000) OK; build:server OK.
- npm test: 3 failures, all in tests/integration/architecture/release-0-2-13-contract.test.ts. They read `src/bin/c4s.ts` to find `codeToExit`, which this branch moved to `src/bin/c4s/errors.ts` → a branch regression (owner: m31-registry-edge-cases).
- test:e2e: 5 files failed; envelope-entity-pages passes solo. artifact-threads-panel ("no plan — seed one first"), entity-version-history and plan-footer look like the empty-seed set, and editor-l8-contexts like the known l8 flake. Comparison against main pending.

## Comparison against main + re-runs (2026-10-11)

- impl-2-1-12-main (main @ bbad8fc): artifact-threads-panel, entity-version-history and plan-footer fail identically ("… seed one first") → empty-seed, pre-existing.
- editor-l8-contexts › "page context derived from the root kind…": branch a456725 pass/fail/fail, main bbad8fc fail/fail/pass (same assertion, line 464) → pre-existing timing flake (caret lands at doc end).
- release-0-2-13-contract at a456725: 38/38 passed.
- envelope-entity-pages: passed solo on the branch.
- Unit suite at 165301e: the only failures were the 3 contract tests (fixed). The rest is green.

## System verifier (2026-10-11): 21/21 rows covered (16 ac, welcome-page, flagi-cli-m01, 2 goals, job:m31); stubs empty; no deviations.
