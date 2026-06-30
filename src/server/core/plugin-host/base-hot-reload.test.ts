/**
 * M33 (0.1.92) — base hot-reload covers an ESM-only package end-to-end.
 *
 * The brief's edge case: a base plugin whose `exports["."]` declares ONLY the
 * `import` condition (no `require`/`default`) is observable by the base watcher —
 * editing its `dist` triggers the reload pipeline without a process restart and
 * without a CJS condition. This wires the same pipeline as `server/index.ts`
 * (watcher → reloadPlugin → `plugin:reloaded` broadcast) against a real on-disk
 * ESM-only package built at runtime (the convention used by overlay-loader.test).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspacePlugins, reloadPlugin } from './loader.js';
import { PluginWatcher } from './plugin-watcher.js';
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
  hostApiVersion: '^1.0.0',
  onUnregister: () => {},
  contributes: {
    settings: [
      { key: 'enabled', label: 'Enabled', control: 'toggle', kind: 'hot-reload', default: true },
    ],
  },
};
`;
}

describe('M33 — base hot-reload of an ESM-only package', () => {
  let pkgDir: string;
  let distDir: string;
  let entry: string;
  let watcher: PluginWatcher | null = null;

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

  it('(b) editing its dist triggers the base reload pipeline (no restart, no CJS condition)', async () => {
    const registry = new PluginRegistryImpl();
    // Seed v1.0.0 as the bootstrap would.
    const importer = (specifier: string) =>
      import(specifier === NAME ? pathToFileURL(entry).href : specifier);
    await loadWorkspacePlugins(registry, [NAME], importer);
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0');

    // Replicate the `server/index.ts:336-360` base-watcher callback: on a change
    // under the watched dist dir, reload the package and record a `plugin:reloaded`
    // broadcast. `reloadPlugin` uses the REAL dynamic import + content-hash
    // cache-bust; `resolveEntry` points at the fixture's `import` entry — exactly
    // what `resolveBaseEntry` yields for an installed ESM-only package.
    const broadcasts: Array<{ kind: string; name: string; version: string; tier: string }> = [];
    let chain: Promise<void> = Promise.resolve();
    watcher = new PluginWatcher([distDir], (changed) => {
      if (!changed.some((p) => p === distDir || p.startsWith(distDir + path.sep))) return;
      chain = chain
        .then(async () => {
          const rec = await reloadPlugin(registry, NAME, { resolveEntry: () => entry });
          broadcasts.push({
            kind: 'plugin:reloaded',
            name: rec.manifestName ?? NAME,
            version: rec.manifestVersion ?? '',
            tier: 'base',
          });
        })
        .catch(() => {});
    });
    watcher.start();
    await new Promise((r) => setTimeout(r, 150)); // let chokidar settle

    // Rebuild the package's dist with a bumped version.
    fs.writeFileSync(entry, moduleSource('2.0.0'));

    expect(await until(() => broadcasts.some((b) => b.version === '2.0.0'))).toBe(true);
    expect(registry.listPluginRecords()[0]?.version).toBe('2.0.0');
    expect(broadcasts.at(-1)).toEqual({
      kind: 'plugin:reloaded',
      name: NAME,
      version: '2.0.0',
      tier: 'base',
    });
  });
});
