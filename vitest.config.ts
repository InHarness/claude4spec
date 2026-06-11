import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // native better-sqlite3 crashes under worker_threads; forks are safe
    pool: 'forks',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
  },
});
