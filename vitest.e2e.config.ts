import { defineConfig } from 'vitest/config';

/**
 * End-to-end suite: drives a real (headless) browser against a RUNNING app,
 * so it is deliberately kept out of the default `npm test` (see the `exclude`
 * in vitest.config.ts) and given its own command:
 *
 *   C4S_E2E_BASE_URL=http://localhost:3600 npm run test:e2e
 *   npm run test:e2e -- -t 'purge'        # pick a single case / AC marker
 *
 * Without `C4S_E2E_BASE_URL` every case skips, so the command is safe to run
 * anywhere (CI included) — there is simply nothing to point the browser at.
 * The base URL is normally an env-runner environment built from the branch
 * under test (see the `c4s-env-runner` skill).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    // Browser launch + page loads are far slower than a unit test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These cases mutate shared workspace state (register/remove a project),
    // so they must not race each other.
    fileParallelism: false,
  },
});
