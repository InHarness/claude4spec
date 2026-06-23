import { describe, expect, it, vi } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import type { ProjectPluginOverlay } from './types.js';
import { fooManifest } from './__fixtures__/plugins.js';

/** Manifest with one entity contribution (to assert module drop on unregister). */
function entityManifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: '@c4s/plugin-with-entity',
    version: '1.0.0',
    hostApiVersion: '^1.0.0',
    onUnregister: () => {},
    contributes: {
      entities: [
        {
          type: 'widget',
          table: 'widget',
          label: 'Widget',
          labelPlural: 'Widgets',
          displayOrder: 100,
          slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? 'widget'),
          pathPrefix: '/widgets',
          serializer: {},
          systemPrompt: {
            roleNoun: 'widget',
            countStat: { placeholder: 'widgetCount', sqlQuery: 'SELECT 0 AS count', label: 'widget' },
            mcpToolsLine: 'widget-tools: ...',
          },
        },
      ],
    },
    ...over,
  };
}

describe('M33 — registry capability records', () => {
  it('retains settings + commands per plugin in listPluginRecords', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    const records = registry.listPluginRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: '@c4s/plugin-foo', version: '0.1.0' });
    expect(records[0]?.settings.map((f) => f.key)).toEqual(['enableBadge', 'apiBase']);
    expect(records[0]?.commands.map((c) => c.trigger)).toEqual(['foo']);
  });

  it('unregisterPlugin calls onUnregister and drops the record + its entity modules', () => {
    const registry = new PluginRegistryImpl();
    const onUnregister = vi.fn();
    registry.registerPlugin(entityManifest({ onUnregister }));
    expect(registry.getAvailable('widget')).not.toBeNull();

    registry.unregisterPlugin('@c4s/plugin-with-entity');
    expect(onUnregister).toHaveBeenCalledTimes(1);
    expect(registry.listPluginRecords()).toHaveLength(0);
    expect(registry.getAvailable('widget')).toBeNull();
  });

  it('unregisterPlugin is a no-op for an unknown name', () => {
    const registry = new PluginRegistryImpl();
    expect(() => registry.unregisterPlugin('@c4s/nope')).not.toThrow();
  });

  it('unregisterPlugin does NOT delete a type now owned by a later same-typed plugin', () => {
    const registry = new PluginRegistryImpl();
    // Two base plugins both contribute type 'widget' (base layer allows it — the
    // second overwrites the module slot).
    registry.registerPlugin(entityManifest({ name: '@c4s/plugin-a' }));
    registry.registerPlugin(entityManifest({ name: '@c4s/plugin-b' }));
    const moduleB = registry.getAvailable('widget');

    // Unregistering A must leave B's 'widget' module intact (identity check).
    registry.unregisterPlugin('@c4s/plugin-a');
    expect(registry.getAvailable('widget')).toBe(moduleB);
    expect(registry.listPluginRecords().map((r) => r.name)).toEqual(['@c4s/plugin-b']);
  });

  it('swallows a throwing onUnregister (idempotent, non-blocking contract)', () => {
    const registry = new PluginRegistryImpl();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registry.registerPlugin(
      fooManifest(() => {
        throw new Error('boom');
      }),
    );
    expect(() => registry.unregisterPlugin('@c4s/plugin-foo')).not.toThrow();
    expect(registry.listPluginRecords()).toHaveLength(0);
    warn.mockRestore();
  });

  it('warns but still registers a manifest missing onUnregister (no-op teardown)', () => {
    const registry = new PluginRegistryImpl();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = fooManifest();
    // Simulate a plugin built without the required slot.
    delete (bad as { onUnregister?: unknown }).onUnregister;
    registry.registerPlugin(bad);
    expect(warn).toHaveBeenCalled();
    expect(registry.listPluginRecords()).toHaveLength(1);
    expect(() => registry.unregisterPlugin('@c4s/plugin-foo')).not.toThrow();
    warn.mockRestore();
  });
});

describe('M33 — host.listSettings / listCommands ignore config.entities', () => {
  it('surfaces base-plugin settings + commands even when the entity whitelist is empty', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    // entities: [] ⇒ axis A says NOTHING active; axis B (pool + trust) must still
    // surface the plugin's settings + commands.
    const host = registry.consolidate({ entities: [] });
    expect(host.listSettings().map((s) => s.name)).toEqual(['@c4s/plugin-foo']);
    expect(host.listSettings()[0]?.fields.map((f) => f.key)).toEqual(['enableBadge', 'apiBase']);
    expect(host.listCommands().map((c) => c.trigger)).toEqual(['foo']);
  });

  it('merges base + trusted overlay capabilities (overlay shadows base by name)', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    const overlay: ProjectPluginOverlay = {
      listLocal: () => [],
      origin: () => '',
      listSettings: () => [
        { name: '@c4s/overlay-bar', version: '2.0.0', fields: [{ key: 'x', label: 'X', control: 'toggle', kind: 'hot-reload', default: false }] },
      ],
      listCommands: () => [{ name: 'bar-cmd', trigger: 'bar', label: 'Bar', popoverKind: 'bar' }],
    };
    const host = registry.consolidate({ entities: [] }, overlay);
    expect(host.listSettings().map((s) => s.name).sort()).toEqual(['@c4s/overlay-bar', '@c4s/plugin-foo']);
    expect(host.listCommands().map((c) => c.trigger).sort()).toEqual(['bar', 'foo']);
  });

  it('omits a plugin with no settings from listSettings', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin({
      name: '@c4s/no-settings',
      version: '1.0.0',
      hostApiVersion: '^1.0.0',
      onUnregister: () => {},
      contributes: {},
    });
    expect(registry.consolidate({}).listSettings()).toEqual([]);
  });
});
