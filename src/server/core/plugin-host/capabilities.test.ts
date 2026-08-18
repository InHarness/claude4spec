import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
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
    hostApiVersion: '^2.0.0',
    onUnregister: () => {},
    contributes: {
      entities: [
        {
          type: 'widget',
          data: FIXTURE_DATA,
          slugPattern: FIXTURE_SLUG_PATTERN,
          payloadVersion: 1,
          label: 'Widget',
          labelPlural: 'Widgets',
          displayOrder: 100,
          pathPrefix: '/widgets',
          systemPrompt: {
            roleNoun: 'widget',
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

  it('unregisterPlugin drops the record + its entity modules WITHOUT calling onUnregister', () => {
    // 0.2.29 inverted the ownership: unwiring capability is the host's, and it
    // happens here; the plugin's optional hook is for its OWN resources and is
    // called by the reload pipeline BEFORE this, never from inside it. Calling
    // it here as well would make a faulty hook able to hold up the host's step.
    const registry = new PluginRegistryImpl();
    const onUnregister = vi.fn();
    registry.registerPlugin(entityManifest({ onUnregister }));
    expect(registry.getAvailable('widget')).not.toBeNull();

    registry.unregisterPlugin('@c4s/plugin-with-entity');
    expect(onUnregister).not.toHaveBeenCalled();
    expect(registry.listPluginRecords()).toHaveLength(0);
    expect(registry.getAvailable('widget')).toBeNull();
  });

  it('exposes the optional onUnregister on the record so the reload pipeline can call it', () => {
    // The loader reads the OLD version's hook off `listPluginRecords()` — this
    // is the only channel it has, so the record must carry it verbatim, and must
    // carry `undefined` when the manifest declared none.
    const registry = new PluginRegistryImpl();
    const onUnregister = vi.fn();
    registry.registerPlugin(entityManifest({ onUnregister }));
    registry.listPluginRecords()[0]?.onUnregister?.();
    expect(onUnregister).toHaveBeenCalledTimes(1);

    const bare = new PluginRegistryImpl();
    const noHook = fooManifest();
    delete (noHook as { onUnregister?: unknown }).onUnregister;
    bare.registerPlugin(noHook);
    expect(bare.listPluginRecords()[0]?.onUnregister).toBeUndefined();
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

  it('a throwing onUnregister cannot block unregisterPlugin — it is not called from here at all', () => {
    // The non-blocking guarantee used to be a try/catch inside the registry.
    // Since 0.2.29 it is structural: the registry never invokes the hook, so
    // there is nothing for a throw to interrupt. (`reload.test.ts` pins the
    // other half — the loader, which DOES call it, swallows the throw.)
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(
      fooManifest(() => {
        throw new Error('boom');
      }),
    );
    expect(() => registry.unregisterPlugin('@c4s/plugin-foo')).not.toThrow();
    expect(registry.listPluginRecords()).toHaveLength(0);
  });

  it('registers a manifest declaring no onUnregister, silently — the slot is optional', () => {
    // Absence is now the NORMAL case for a declarative package, so it must not
    // warn: a warning on every well-formed plugin is noise that trains readers
    // to ignore the channel.
    const registry = new PluginRegistryImpl();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bare = fooManifest();
    delete (bare as { onUnregister?: unknown }).onUnregister;
    registry.registerPlugin(bare);
    expect(warn).not.toHaveBeenCalled();
    expect(registry.listPluginRecords()).toHaveLength(1);
    expect(() => registry.unregisterPlugin('@c4s/plugin-foo')).not.toThrow();
    warn.mockRestore();
  });

  it('drops the settings DESCRIPTOR on unregister — the values under config.plugins are not its to touch', () => {
    // The brief's line: `contributes.settings` is a descriptor of a section under
    // `config.plugins[<name>]`, and only the descriptor is the registry's to
    // remove. Wiping the user's values because a package was momentarily
    // unregistered — every hot-reload does exactly that — would be data loss.
    //
    // The values half is structural rather than asserted here: the registry is
    // constructed with no config reference at all, so it has no channel through
    // which to reach them. What CAN be pinned is that the descriptor goes.
    // Persistence of the values across writes is covered end-to-end in
    // `tests/integration/api/config-plugins.test.ts`.
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    expect(registry.consolidate({}).listSettings().map((s) => s.name)).toEqual(['@c4s/plugin-foo']);

    registry.unregisterPlugin('@c4s/plugin-foo');
    expect(registry.consolidate({}).listSettings()).toEqual([]);
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
      hostApiVersion: '^2.0.0',
      onUnregister: () => {},
      contributes: {},
    });
    expect(registry.consolidate({}).listSettings()).toEqual([]);
  });
});

describe('M37 — contributes.skills (0.2.19)', () => {
  const skill = (over: Record<string, unknown> = {}) => ({
    slug: 'house-rules',
    title: 'House Rules',
    description: 'always on',
    version: 1,
    language: 'en' as const,
    scope: 'contextual' as const,
    content: '# House rules',
    ...over,
  });

  function skillManifest(name: string, contributes: PluginManifest['contributes']): PluginManifest {
    return { name, version: '1.0.0', hostApiVersion: '^2.0.0', onUnregister: () => {}, contributes };
  }

  it('collects skills of either scope through listSkills', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(
      skillManifest('@c4s/plugin-skills', {
        skills: [skill(), skill({ slug: 'terse', scope: 'writing-style', title: 'Terse' })],
      }),
    );
    expect(registry.listSkills().map((s) => [s.slug, s.scope])).toEqual([
      ['house-rules', 'contextual'],
      ['terse', 'writing-style'],
    ]);
  });

  it('lowers contributes.writingStyles to the SAME shape — the older slot is sugar, not a second path', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(
      skillManifest('@c4s/plugin-style', {
        writingStyles: [
          { slug: 'terse', title: 'Terse', description: 'short', version: 1, language: 'en', content: 'body' },
        ],
      }),
    );
    expect(registry.listSkills()).toEqual([
      { slug: 'terse', title: 'Terse', description: 'short', version: 1, language: 'en', content: 'body', scope: 'writing-style' },
    ]);
  });

  it('rejects a skill contribution with an unknown scope, failing that plugin atomically', () => {
    const registry = new PluginRegistryImpl();
    expect(() =>
      registry.registerPlugin(skillManifest('@c4s/plugin-bad', { skills: [skill({ scope: 'everywhere' })] })),
    ).toThrow(/scope must be/);
    expect(registry.listSkills()).toEqual([]);
  });

  it('drops a plugin\'s skills again on unregister, so a hot-reload cannot leave a stale one behind', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(skillManifest('@c4s/plugin-skills', { skills: [skill()] }));
    registry.unregisterPlugin('@c4s/plugin-skills');
    expect(registry.listSkills()).toEqual([]);
  });
});
