import { describe, expect, it, vi } from 'vitest';
import { reloadPlugin } from './loader.js';
import { PluginRegistryImpl } from './registry.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';

/** A plugin contributing one entity type + a spy-able onUnregister. */
function pluginV(version: string, onUnregister: () => void = () => {}): PluginManifest {
  return {
    name: '@c4s/reloadable',
    version,
    hostApiVersion: '^1.0.0',
    onUnregister,
    contributes: {
      entities: [
        {
          type: 'thing',
          table: 'thing',
          label: 'Thing',
          labelPlural: 'Things',
          displayOrder: 100,
          slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? 'thing'),
          pathPrefix: '/things',
          serializer: {},
          systemPrompt: {
            roleNoun: 'thing',
            countStat: { placeholder: 'thingCount', sqlQuery: 'SELECT 0 AS count', label: 'thing' },
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
  it('tears down the old version (onUnregister) then registers the new one', async () => {
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

    const incompatible = { ...pluginV('2.0.0'), hostApiVersion: '^2.0.0' };
    const rec = await reloadPlugin(registry, '@c4s/reloadable', seams({ manifest: incompatible }));

    expect(rec).toMatchObject({ status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(rec.migration?.targetHostApiVersion).toBe('1.0.0');
    expect(oldTeardown).not.toHaveBeenCalled();
    expect(registry.listPluginRecords()[0]?.version).toBe('1.0.0');
    warn.mockRestore();
  });
});
