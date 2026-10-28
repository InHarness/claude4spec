/**
 * M33 (0.1.92) — base hot-reload covers an ESM-only package end-to-end.
 *
 * The brief's edge case: a base plugin whose `exports["."]` declares ONLY the
 * `import` condition (no `require`/`default`) is observable by the base watcher —
 * editing its `dist` triggers the reload pipeline without a process restart and
 * without a CJS condition. The watcher subscription calls the production pipeline
 * `reloadBasePackages` (reload → one `invalidateAll` → `plugin:reloaded`
 * broadcast), as `server/index.ts` does, against a real on-disk ESM-only package
 * built at runtime (the convention used by overlay-loader.test).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspacePlugins } from './loader.js';
import { reloadBasePackages, type PluginReloadedEvent } from './base-reload.js';
import { FileWatchRuntime } from '../../fs/watcher.js';
import { PLUGINS_BASE_SOURCE } from '../../fs/sources.js';
import { PluginRegistryImpl } from './registry.js';

const NAME = '@c4s-fixture/esm-only-plugin';

/** Poll until `cond()` is truthy or `timeoutMs` elapses. */
async function until(cond: () => boolean, timeoutMs = 4000, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

/** Body of the fixture's `dist/index.js` — exports a valid M33 manifest. */
function moduleSource(version: string): string {
  return `export const manifest = {
  name: ${JSON.stringify(NAME)},
  version: ${JSON.stringify(version)},
  hostApiVersion: '^2.0.0',
  onUnregister: () => {},
  contributes: {
    commands: [
      { name: 'esm-only-insert', trigger: 'esm', label: 'Insert ESM', popoverKind: 'esm' },
    ],
  },
};
`;
}

describe('M33 — base hot-reload of an ESM-only package', () => {
  let pkgDir: string;
  let distDir: string;
  let entry: string;
  let watcher: FileWatchRuntime | null = null;

  beforeEach(() => {
    pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-esm-only-'));
    distDir = path.join(pkgDir, 'dist');
    entry = path.join(distDir, 'index.js');
    fs.mkdirSync(distDir, { recursive: true });
    // ESM-only: `exports["."]` has ONLY the `import` condition — no `require`/`default`.
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify(
        { name: NAME, version: '1.0.0', type: 'module', exports: { '.': { import: './dist/index.js' } } },
        null,
        2,
      ),
    );
    fs.writeFileSync(entry, moduleSource('1.0.0'));
  });

  afterEach(async () => {
    await watcher?.close();
    watcher = null;
    fs.rmSync(pkgDir, { recursive: true, force: true });
  });

  it('the fixture really is ESM-only (no require/default condition)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    expect(pkg.exports['.']).toEqual({ import: './dist/index.js' });
    expect(pkg.exports['.'].require).toBeUndefined();
    expect(pkg.exports['.'].default).toBeUndefined();
  });

  it('(a) loads and registers at bootstrap via native dynamic import', async () => {
    const registry = new PluginRegistryImpl();
    // Mirror the bootstrap importer: a bare specifier resolves to the package's
    // `import`-condition entry (here the on-disk fixture).
    const importer = (specifier: string) =>
      import(specifier === NAME ? pathToFileURL(entry).href : specifier);

    const { records } = await loadWorkspacePlugins(registry, [NAME], importer);

    expect(records[0]).toMatchObject({ status: 'loaded', manifestName: NAME, manifestVersion: '1.0.0' });
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0');
  });

  it('[ac:ac-pakiet-plugin-bazy-z-exports-deklaruja-2] (b) editing its dist triggers the base reload pipeline (no restart, no CJS condition)', async () => {
    const registry = new PluginRegistryImpl();
    // Seed v1.0.0 as the bootstrap would.
    const importer = (specifier: string) =>
      import(specifier === NAME ? pathToFileURL(entry).href : specifier);
    const { records } = await loadWorkspacePlugins(registry, [NAME], importer);
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0');

    // `server/index.ts`'s base reload subscription: a `reload`-phase reaction on
    // the process-scope `plugins:base` mount runs the production pipeline
    // `reloadBasePackages` — the REAL dynamic import + content-hash cache-bust,
    // with `resolveEntry` pointing at the fixture's `import` entry (exactly what
    // the base locator, `workspace-packages.ts`, yields for an ESM-only package
    // installed in the workspace `node_modules`).
    const broadcasts: PluginReloadedEvent[] = [];
    let invalidations = 0;
    let chain: Promise<void> = Promise.resolve();
    const onChange = (): void => {
      chain = chain
        .then(() =>
          reloadBasePackages(
            {
              pluginRegistry: registry,
              records,
              resolveEntry: () => entry,
              invalidateAll: () => {
                invalidations += 1;
              },
              broadcast: (event) => broadcasts.push(event),
            },
            [NAME],
          ),
        )
        .catch(() => {});
    };
    watcher = new FileWatchRuntime();
    watcher.mountSource({ source: PLUGINS_BASE_SOURCE, dir: distDir, scope: 'process' });
    watcher.subscribe(
      PLUGINS_BASE_SOURCE,
      { onChange, onUnlink: onChange },
      { id: 'm33-base-reload', phase: 'reload', scope: 'process' },
    );
    await new Promise((r) => setTimeout(r, 150)); // let the fs provider finish its first listing

    // Rebuild the package's dist with a bumped version.
    fs.writeFileSync(entry, moduleSource('2.0.0'));

    expect(await until(() => broadcasts.some((b) => b.version === '2.0.0'))).toBe(true);
    await chain;
    expect(registry.listPluginRecords()[0]?.version).toBe('2.0.0');
    expect(records[0]).toMatchObject({ status: 'loaded', manifestVersion: '2.0.0' });
    expect(invalidations).toBeGreaterThanOrEqual(1);
    expect(invalidations).toBe(broadcasts.length);
    expect(broadcasts.at(-1)).toEqual({
      kind: 'plugin:reloaded',
      name: NAME,
      version: '2.0.0',
      tier: 'base',
    });
  });
});
