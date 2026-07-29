import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';

/**
 * `new URL(...).pathname` is NOT a filesystem path: it keeps percent-encoding,
 * so a checkout under a directory with a space resolves to a path that does not
 * exist, and on Windows it yields a leading-slash `/C:/…`. `fileURLToPath` is
 * the decode step. An alias that silently resolves to nothing would take the
 * whole envelope down with it — see the comment on `resolve.alias` below.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  /**
   * 0.2.2 — resolve the plugin runtime for builtin envelopes.
   *
   * At runtime the host installs a `module.register` loader hook that maps the
   * bare `@c4s/plugin-runtime` specifier onto its own barrel. That hook cannot
   * install under vitest: it resolves a compiled `.js` sibling that only exists
   * in `dist/`. Without an alias the envelope's built bundle fails to import
   * with PLUGIN_IMPORT_FAILED and `endpoint`/`dto` silently vanish from every
   * test, so this alias reproduces exactly what the hook does in production.
   *
   * That makes the alias a risk as well as a convenience: it would keep the
   * suite green even if the production resolver stopped working. The case in
   * `plugin-runtime-resolver.subprocess.test.ts` ("builtin envelope — real load
   * path") is what covers that — it runs outside this module graph, so no alias
   * can satisfy it.
   */
  resolve: {
    alias: {
      '@c4s/plugin-runtime/ui': here('./src/server/plugin-runtime/ui.ts'),
      '@c4s/plugin-runtime': here('./src/server/plugin-runtime/index.ts'),
    },
  },
  test: {
    environment: 'node',
    // native better-sqlite3 crashes under worker_threads; forks are safe
    pool: 'forks',
    // `plugins/*/test/**` is the builtin-envelope tier. Its suites are the
    // guards for bugs that reached a running environment during 0.2.2 and are
    // invisible to typecheck; leaving them to the separate `test:envelopes`
    // script meant `npm test` — the only command CI and habit actually run —
    // collected neither of them. The alias above is what lets them resolve
    // `@c4s/plugin-runtime` from this config.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'plugins/*/test/**/*.test.ts'],
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
