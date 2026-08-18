import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it, vi } from 'vitest';
import { reloadPlugin } from './loader.js';
import { PluginRegistryImpl } from './registry.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';

/**
 * A plugin contributing one entity type + a spy-able onUnregister. Pass
 * `undefined` for the hook to get a manifest that does not declare the slot at
 * all — since 0.2.29 that is the normal shape of a declarative package.
 */
function pluginV(version: string, onUnregister: (() => void) | undefined = () => {}): PluginManifest {
  return {
    name: '@c4s/reloadable',
    version,
    hostApiVersion: '^2.0.0',
    ...(onUnregister !== undefined ? { onUnregister } : {}),
    contributes: {
      entities: [
        {
          type: 'thing',
          data: FIXTURE_DATA,
          slugPattern: FIXTURE_SLUG_PATTERN,
          payloadVersion: 1,
          label: 'Thing',
          labelPlural: 'Things',
          displayOrder: 100,
          pathPrefix: '/things',
          systemPrompt: {
            roleNoun: 'thing',
            mcpToolsLine: 'thing-tools: ...',
          },
        },
      ],
    },
  };
}

/** Seams so reloadPlugin never touches the real FS / module resolver. */
function seams(mod: unknown) {
  return {
    importer: vi.fn(async () => mod),
    resolveEntry: () => '/fake/entry.js',
    cacheBust: () => '?v=test',
  };
}

describe('M33 — reloadPlugin (base hot-reload pipeline)', () => {
  it('calls the OLD version\'s onUnregister, then unregisters host-side, then registers the new one', async () => {
    const registry = new PluginRegistryImpl();
    const oldTeardown = vi.fn();
    registry.registerPlugin(pluginV('1.0.0', oldTeardown));

    const rec = await reloadPlugin(registry, '@c4s/reloadable', seams({ manifest: pluginV('2.0.0') }));

    expect(rec).toMatchObject({ status: 'loaded', manifestVersion: '2.0.0', layer: 'base' });
    expect(oldTeardown).toHaveBeenCalledTimes(1);
    expect(registry.listPluginRecords()[0]?.version).toBe('2.0.0');
    expect(registry.getAvailable('thing')).not.toBeNull();
  });

  it('retains the old version on import failure (no teardown)', async () => {
    const registry = new PluginRegistryImpl();
    const oldTeardown = vi.fn();
    registry.registerPlugin(pluginV('1.0.0', oldTeardown));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const importer = vi.fn(async () => {
      throw new Error('boom build');
    });
    const rec = await reloadPlugin(registry, '@c4s/reloadable', {
      importer,
      resolveEntry: () => '/fake/entry.js',
      cacheBust: () => '',
    });

    expect(rec).toMatchObject({ status: 'failed', code: 'PLUGIN_IMPORT_FAILED' });
    expect(oldTeardown).not.toHaveBeenCalled();
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0'); // old stays
    warn.mockRestore();
  });

  it('retains the old version when the new manifest passes the gate but fails to lower (atomicity)', async () => {
    const registry = new PluginRegistryImpl();
    const oldTeardown = vi.fn();
    registry.registerPlugin(pluginV('1.0.0', oldTeardown));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Compatible host API + valid shape, but a structurally-broken entity
    // contribution (missing required fields) → lowering throws.
    const broken = {
      ...pluginV('2.0.0'),
      contributes: { entities: [{ type: 'thing' } as unknown] },
    } as PluginManifest;
    const rec = await reloadPlugin(registry, '@c4s/reloadable', seams({ manifest: broken }));

    expect(rec).toMatchObject({ status: 'failed', code: 'PLUGIN_INVALID_MANIFEST' });
    expect(oldTeardown).not.toHaveBeenCalled(); // old not torn down
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0'); // old stays
    expect(registry.getAvailable('thing')).not.toBeNull(); // type still present
    warn.mockRestore();
  });

  it('retains the old version on an incompatible major (no teardown)', async () => {
    const registry = new PluginRegistryImpl();
    const oldTeardown = vi.fn();
    registry.registerPlugin(pluginV('1.0.0', oldTeardown));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // One major behind the host (2.0.0) — the shape a stale package really has,
    // and the crossing `buildMigrationInfo` has a descriptor for.
    const incompatible = { ...pluginV('2.0.0'), hostApiVersion: '^1.0.0' };
    const rec = await reloadPlugin(registry, '@c4s/reloadable', seams({ manifest: incompatible }));

    expect(rec).toMatchObject({ status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(rec.migration?.targetHostApiVersion).toBe('2.0.0');
    expect(oldTeardown).not.toHaveBeenCalled();
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0');
    warn.mockRestore();
  });

  it('reloads a package that declares NO onUnregister, leaving no duplicated slots', async () => {
    // 0.2.29 (b): the guarantee against duplicated slots used to rest on every
    // plugin implementing the hook correctly. It now rests on the host's step,
    // which runs regardless — so a package with no lifecycle at all must reload
    // just as cleanly.
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(pluginV('1.0.0', undefined));
    const first = registry.getAvailable('thing');

    const rec = await reloadPlugin(
      registry,
      '@c4s/reloadable',
      seams({ manifest: pluginV('2.0.0', undefined) }),
    );

    expect(rec).toMatchObject({ status: 'loaded', manifestVersion: '2.0.0' });
    // Exactly one record and exactly one module for the type — not two of either.
    expect(registry.listPluginRecords()).toHaveLength(1);
    expect(registry.listPluginRecords()[0]?.version).toBe('2.0.0');
    expect(registry.listAvailable().filter((m) => m.type === 'thing')).toHaveLength(1);
    // And it is the NEW module, not the one the first registration left behind.
    expect(registry.getAvailable('thing')).not.toBe(first);
  });

  it('a throwing onUnregister is a warning, not a block — the host step still runs', async () => {
    // 0.2.29 (c): step 2a cannot hold up step 2b. A plugin whose teardown throws
    // must still be unregistered and replaced, or one faulty package could pin a
    // stale version in the pool forever.
    const registry = new PluginRegistryImpl();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.registerPlugin(
      pluginV('1.0.0', () => {
        throw new Error('teardown boom');
      }),
    );

    const rec = await reloadPlugin(registry, '@c4s/reloadable', seams({ manifest: pluginV('2.0.0') }));

    expect(rec).toMatchObject({ status: 'loaded', manifestVersion: '2.0.0' });
    expect(registry.listPluginRecords()).toHaveLength(1);
    expect(registry.listPluginRecords()[0]?.version).toBe('2.0.0');
    expect(registry.listAvailable().filter((m) => m.type === 'thing')).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('teardown boom'));
    warn.mockRestore();
  });
});
