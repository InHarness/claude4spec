System verification (2026-10-18), env-runner `2-1-30-to-2-1-33` @ dbfbf7ff:
- verifier-system (static): 24/24 ui-kit-component, section:thm8a14c, no jobs/stubs/deviations, typecheck green.
- vitest in env: 1969/1969 suites, 6492/6492 tests.
- e2e full run: 35/40 files, 201 passed / 3 failed / 19 skipped. Failing files: artifact-threads-panel, plan-footer, entity-version-history (empty seed — same set as main/PR #283); envelope-entity-pages (needs an endpoint → 7/7 alone once one exists); frontend-mockups-envelope (interference → 6/6 alone).
