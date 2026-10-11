# System verification — env-runner run 1 (impl-2-1-12 @ 165301e, thread wMaAzDvyfU21)

- npm ci (lockfile, uid 1000) OK; build:server OK.
- npm test: 3 failures, all in tests/integration/architecture/release-0-2-13-contract.test.ts. They read `src/bin/c4s.ts` to find `codeToExit`, which this branch moved to `src/bin/c4s/errors.ts` → a branch regression (owner: m31-registry-edge-cases).
- test:e2e: 5 files failed; envelope-entity-pages passes solo. artifact-threads-panel ("no plan — seed one first"), entity-version-history and plan-footer look like the empty-seed set, and editor-l8-contexts like the known l8 flake. Comparison against main pending.
