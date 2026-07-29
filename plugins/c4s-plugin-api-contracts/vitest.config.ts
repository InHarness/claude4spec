import { defineConfig } from 'vitest/config';

/**
 * The envelope's own suite. It runs against `src/`, not the built bundle, and
 * needs the same `@c4s/plugin-runtime` alias the host's config carries — the
 * loader hook that provides that specifier at runtime cannot install here.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@c4s/plugin-runtime/ui': new URL('../../src/server/plugin-runtime/ui.ts', import.meta.url).pathname,
      '@c4s/plugin-runtime': new URL('../../src/server/plugin-runtime/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    // native better-sqlite3 crashes under worker_threads; forks are safe
    pool: 'forks',
    include: ['test/**/*.test.ts'],
  },
});
