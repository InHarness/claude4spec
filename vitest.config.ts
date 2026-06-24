import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // native better-sqlite3 crashes under worker_threads; forks are safe
    pool: 'forks',
    // `.test.tsx` files opt into the jsdom DOM environment via a per-file
    // `// @vitest-environment jsdom` docblock; the default stays `node` (above)
    // so better-sqlite3 + forks keep working for every other suite.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
  },
});
