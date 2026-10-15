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
  it('retains commands + subagents per plugin in listPluginRecords — and no settings', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    const records = registry.listPluginRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: '@c4s/plugin-foo', version: '0.1.0' });
    expect(records[0]?.commands.map((c) => c.trigger)).toEqual(['foo']);
    expect(records[0]?.subagents.map((s) => s.name)).toEqual(['foo-explore']);
    expect(records[0]).not.toHaveProperty('settings');
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

  /**
   * 2.1.20 (M13 m13plenv) — `contributes.entities[]` carries the flat identity
   * plus server slots, and NO frontend slot: a type's frontend is a separate
   * module the plugin registers from its browser entry. A package still putting
   * `frontend` into its entity contribution fails `registerPlugin` atomically —
   * none of its types is registered.
   */
  it('[section:m13plenv] registerPlugin refuses an entity contribution carrying a frontend slot, registering nothing of that plugin', () => {
    const registry = new PluginRegistryImpl();
    const manifest = entityManifest({ name: '@c4s/plugin-old-frontend' });
    const entity = manifest.contributes.entities![0]!;
    (entity as unknown as Record<string, unknown>).frontend = { renderChip: () => null, renderCard: () => null };
    expect(() => registry.registerPlugin(manifest)).toThrow(/`frontend` slot was withdrawn from the type contribution/);
    expect(registry.getAvailable('widget')).toBeNull();
    expect(registry.listPluginRecords()).toHaveLength(0);

    // The same envelope without the slot registers its type.
    const clean = entityManifest({ name: '@c4s/plugin-clean' });
    expect('frontend' in clean.contributes.entities![0]!).toBe(false);
    registry.registerPlugin(clean);
    expect(registry.getAvailable('widget')).not.toBeNull();
  });

});

/**
 * 2.1.21 (M33 `m33l2001`, M13 `z7l89jhf` / `m13plenv`) — the envelope's fan-out is
 * exactly five slots, none of which is `settings`: entities → registerEntityModule,
 * writingStyles + skills → the M37 SkillRegistry (pull-read via `listSkills`),
 * commands → the editor-extension channel (`listCommands`), subagents → the
 * subagent-contribution registry (`listSubagents`). The envelope carries no XML
 * reference types. A stale `settings` / `referenceTypes` key on an old manifest
 * reaches no registry at all.
 */
describe('M33 — registerPlugin fan-out (2.1.21)', () => {
  function fiveSlotManifest(): PluginManifest {
    const base = entityManifest({ name: '@c4s/plugin-five' });
    const manifest: PluginManifest = {
      ...base,
      contributes: {
        entities: base.contributes.entities,
        writingStyles: [
          { slug: 'terse', title: 'Terse', description: 'short', version: 1, language: 'en', content: 'body' },
        ],
        skills: [
          {
            slug: 'house-rules',
            title: 'House Rules',
            description: 'always on',
            version: 1,
            language: 'en',
            scope: 'contextual',
            content: '# House rules',
          },
        ],
        commands: [{ name: 'five-insert', trigger: 'five', label: 'Insert Five', popoverKind: 'five' }],
        subagents: [{ name: 'five-explore', description: 'Explores five.', promptBody: 'Explore.', tools: ['Read'] }],
      },
    };
    // Retired slots an outdated package may still carry — they must reach nothing.
    const legacy = manifest.contributes as Record<string, unknown>;
    legacy.settings = [{ key: 'flag', label: 'Flag', control: 'toggle', kind: 'hot-reload', default: true }];
    legacy.referenceTypes = [{ tag: 'five_ref' }];
    return manifest;
  }

  it('[ac:ac-registerplugin-fan-outuje-wylacznie-c] [section:m33l2001] [section:m13plenv] fans out exactly entities, writingStyles, skills, commands and subagents — no settings, no XML reference types', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fiveSlotManifest());
    const host = registry.consolidate({});

    // entities → registerEntityModule
    expect(registry.getAvailable('widget')?.type).toBe('widget');
    // writingStyles + skills → the same SkillRegistry feed
    expect(registry.listSkills().map((s) => [s.slug, s.scope]).sort()).toEqual([
      ['house-rules', 'contextual'],
      ['terse', 'writing-style'],
    ]);
    // commands → editor-extension channel; subagents → subagent-contribution registry
    expect(host.listCommands().map((c) => c.trigger)).toEqual(['five']);
    expect(host.listSubagents().map((s) => s.name)).toEqual(['five-explore']);

    // No settings channel: neither the record nor the host exposes one.
    const record = registry.listPluginRecords()[0]!;
    expect(Object.keys(record).sort()).toEqual(
      ['commands', 'contributedTypes', 'name', 'onUnregister', 'subagents', 'version'].sort(),
    );
    expect('listSettings' in host).toBe(false);
    // No XML reference types: the plugin contributed only its entity type.
    expect(record.contributedTypes).toEqual(['widget']);
  });

  it('[ac:ac-registerplugin-fan-outuje-wylacznie-c] unregisterPlugin takes the same five slots back and hands nothing to a settings registry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fiveSlotManifest());
    registry.unregisterPlugin('@c4s/plugin-five');
    const host = registry.consolidate({});
    expect(registry.getAvailable('widget')).toBeNull();
    expect(registry.listSkills()).toEqual([]);
    expect(host.listCommands()).toEqual([]);
    expect(host.listSubagents()).toEqual([]);
    expect(registry.listPluginRecords()).toEqual([]);
  });
});

describe('M33 — host.listCommands / listSubagents ignore config.entities', () => {
  it('[section:m13plset] surfaces base-plugin commands + subagents even when the entity whitelist is empty', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    // entities: [] ⇒ axis A says NOTHING active; axis B (pool + trust) must still
    // surface the plugin's commands + subagents.
    const host = registry.consolidate({ entities: [] });
    expect(host.listCommands().map((c) => c.trigger)).toEqual(['foo']);
    expect(host.listSubagents().map((s) => s.name)).toEqual(['foo-explore']);
  });

  it('merges base + trusted overlay commands', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(fooManifest());
    const overlay: ProjectPluginOverlay = {
      listLocal: () => [],
      origin: () => '',
      listCommands: () => [{ name: 'bar-cmd', trigger: 'bar', label: 'Bar', popoverKind: 'bar' }],
      listSubagents: () => [],
    };
    const host = registry.consolidate({ entities: [] }, overlay);
    expect(host.listCommands().map((c) => c.trigger).sort()).toEqual(['bar', 'foo']);
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

  it('carries a valid contextTypes through to the registry entry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(
      skillManifest('@c4s/plugin-narrow', { skills: [skill({ contextTypes: ['chat'] })] }),
    );
    expect(registry.listSkills().map((x) => x.contextTypes)).toEqual([['chat']]);
  });

  it('leaves contextTypes undefined when the package omits it — the resolver reads the absence', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(skillManifest('@c4s/plugin-wide', { skills: [skill()] }));
    expect(registry.listSkills()[0].contextTypes).toBeUndefined();
  });

  /**
   * 0.2.66 — the ONE skill defect that costs its own entry rather than the envelope.
   * Every other malformed field throws and fails the plugin atomically (see the
   * `scope` case above); `contextTypes` is a selector over turns, not part of the
   * skill's identity, so a typo in it must not take an envelope's entities and
   * subagents down with it.
   */
  it('[ac:ac-wpis-contributes-skills-z-wartoscia-c] skips a contribution whose contextTypes names a turn that does not exist, warning and loading the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new PluginRegistryImpl();
    try {
      expect(() =>
        registry.registerPlugin(
          skillManifest('@c4s/plugin-mixed', {
            skills: [
              skill({ slug: 'bad', contextTypes: ['chat', 'review'] }),
              skill({ slug: 'good', contextTypes: ['brief'] }),
            ],
          }),
        ),
      ).not.toThrow();

      expect(registry.listSkills().map((x) => x.slug)).toEqual(['good']);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/"bad".*contextTypes.*"review"/);
    } finally {
      warn.mockRestore();
    }
  });

  it('skips a contribution whose contextTypes is not an array at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new PluginRegistryImpl();
    try {
      registry.registerPlugin(
        skillManifest('@c4s/plugin-nonarray', {
          skills: [skill({ contextTypes: 'chat' as unknown as ['chat'] })],
        }),
      );
      expect(registry.listSkills()).toEqual([]);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/must be an array/);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The skip is priced against ONE LISTING ROW, and that price is only right for a
   * contextual skill. A style reaches a turn through `config.writingStyle` and its
   * own prompt block, never through the listing, so dropping it costs the project
   * its selected style in both the selector and the prompt — over a field that
   * does nothing for a style either way. Warn, keep, move on.
   */
  it('keeps a writing style whose contextTypes is unusable — the field has no effect on a style', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new PluginRegistryImpl();
    try {
      registry.registerPlugin(
        skillManifest('@c4s/plugin-styled', {
          skills: [
            skill({
              slug: 'terse',
              scope: 'writing-style',
              title: 'Terse',
              contextTypes: ['chat', 'breif'] as unknown as ['chat'],
            }),
          ],
        }),
      );
      expect(registry.listSkills().map((x) => x.slug)).toEqual(['terse']);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/"terse".*ignoring the field/);
    } finally {
      warn.mockRestore();
    }
  });

  it('names a slugless contribution readably rather than warning about "undefined"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new PluginRegistryImpl();
    try {
      registry.registerPlugin(
        skillManifest('@c4s/plugin-slugless', {
          skills: [skill({ slug: undefined, contextTypes: ['nope'] })],
        }),
      );
      expect(registry.listSkills()).toEqual([]);
      const said = warn.mock.calls.flat().join(' ');
      expect(said).toContain('(no slug)');
      expect(said).not.toContain('undefined');
    } finally {
      warn.mockRestore();
    }
  });

  it('drops a plugin\'s skills again on unregister, so a hot-reload cannot leave a stale one behind', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(skillManifest('@c4s/plugin-skills', { skills: [skill()] }));
    registry.unregisterPlugin('@c4s/plugin-skills');
    expect(registry.listSkills()).toEqual([]);
  });
});
