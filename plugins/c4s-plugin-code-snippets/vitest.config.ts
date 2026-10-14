import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The envelope's own suite, for running from this directory. The host's root
 * config also collects it (`plugins/<name>/test/**`), so `npm test` at the root
 * is the authority — this config exists for focused iteration, and the two must
 * not drift.
 *
 * It runs against `src/`, not the built bundle, and needs the same
 * `@c4s/plugin-runtime` alias the host's config carries — the loader hook that
 * provides that specifier at runtime cannot install here. `fileURLToPath`, not
 * `.pathname`: see the note in the host's `vitest.config.ts`.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 2.1.20 (M33 `ywud56l6`) — the host repo's internal, unpublished test
      // setup, resolved the way the root config resolves it. Not a published
      // specifier: an extracted package keeps the import in `test/` but has to
      // re-wire this alias to whatever the host publishes by then.
      '@c4s-internal/plugin-test-setup': here('../../tests/helpers/plugin-test-setup.ts'),
      '@c4s/plugin-runtime/ui': here('../../src/server/plugin-runtime/ui.ts'),
      '@c4s/plugin-runtime': here('../../src/server/plugin-runtime/index.ts'),
    },
  },
  test: {
    environment: 'node',
    // native better-sqlite3 crashes under worker_threads; forks are safe
    pool: 'forks',
    include: ['test/**/*.test.ts'],
  },
});
