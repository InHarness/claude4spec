import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // native better-sqlite3 crashes under worker_threads; forks are safe
    pool: 'forks',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // `tests/e2e/**` drives a real browser against a RUNNING app (env-runner URL
    // in `C4S_E2E_BASE_URL`) — it must never join the hermetic default run.
    // Own runner: `npm run test:e2e` (vitest.e2e.config.ts). They still end in
    // `.test.ts` on purpose, so `scripts/ac-coverage.mjs` picks up their
    // `[ac:<slug>]` markers with no change to the coverage script.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
  },
});
