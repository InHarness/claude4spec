import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it, vi } from 'vitest';
import { loadWorkspacePlugins } from './loader.js';
import { PluginRegistryImpl } from './registry.js';
import type { PluginManifest, EntityContribution } from '../../../shared/plugin-host/manifest.js';

function entity(type: string): EntityContribution {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    pathPrefix: `/${type}s`,
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: `SELECT 0 AS count`, label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
  };
}

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: '@acme/c4s-plugin-glossary',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    onUnregister: () => {},
    contributes: { entities: [entity('glossary')] },
    ...over,
  };
}

/** Build a fake importer from a name→module map; unmapped names reject (import fail). */
function fakeImporter(modules: Record<string, unknown>) {
  return vi.fn(async (specifier: string) => {
    if (specifier in modules) return modules[specifier];
    throw new Error(`Cannot find package '${specifier}'`);
  });
}

describe('loadWorkspacePlugins', () => {
  it('loads a compatible plugin and registers its entity types', async () => {
    const registry = new PluginRegistryImpl();
    const importer = fakeImporter({ 'pkg-a': { manifest: manifest() } });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-a'], importer);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      package: 'pkg-a',
      status: 'loaded',
      contributedTypes: ['glossary'],
    });
    expect(registry.getAvailable('glossary')).not.toBeNull();
  });

  it('accepts the manifest on the default export', async () => {
    const registry = new PluginRegistryImpl();
    const importer = fakeImporter({ 'pkg-d': { default: manifest({ name: 'pkg-d' }) } });
    const { records } = await loadWorkspacePlugins(registry, ['pkg-d'], importer);
    expect(records[0]?.status).toBe('loaded');
  });

  it('skips a same-major hostApiVersion that the host cannot satisfy (no migration path)', async () => {
    const registry = new PluginRegistryImpl();
    // `^2.5.0` needs a newer minor than the 2.0.0 host — unsatisfiable but SAME
    // major, so it is `skipped` (not `incompatible`) with no migration descriptor.
    const importer = fakeImporter({ 'pkg-b': { manifest: manifest({ hostApiVersion: '^2.5.0' }) } });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-b'], importer);

    expect(records[0]).toMatchObject({ status: 'skipped', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(records[0]?.migration).toBeUndefined();
    expect(registry.getAvailable('glossary')).toBeNull();
  });

  it('flags an incompatible MAJOR hostApiVersion as `incompatible` with a migration descriptor', async () => {
    const registry = new PluginRegistryImpl();
    // `^3.0.0` targets a different major — incompatible under the 2.x host.
    // One major BEHIND the host — the realistic case since 0.2.22, and the one
    // whose migration descriptor a plugin author actually reads.
    const importer = fakeImporter({ 'pkg-old': { manifest: manifest({ hostApiVersion: '^1.0.0' }) } });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-old'], importer);

    expect(records[0]).toMatchObject({ status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(records[0]?.migration?.targetHostApiVersion).toBe('2.1.0');
    /**
     * The 1 → 2 crossing, which is what makes this record useful: a plugin one
     * major behind gets the six descriptors naming exactly what it must change
     * — every one a removal, because 2.0.0 is where behaviour left the type.
     */
    expect(records[0]?.migration?.migrations).toHaveLength(6);
    expect(records[0]?.migration?.shimAvailable).toBe(false);
    expect(registry.getAvailable('glossary')).toBeNull();
  });

  it('[ac:ac-pakiet-z-niespelnionym-engines-jest-po] skips a plugin whose engines.node is unsatisfied — with a PLUGIN_ENGINE_UNSATISFIED warning, no crash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new PluginRegistryImpl();
      const importer = fakeImporter({
        'pkg-e': { manifest: manifest({ engines: { node: '>=99.0.0' } }) },
      });

      // No crash: the loader resolves (it never throws) with a record.
      const { records } = await loadWorkspacePlugins(registry, ['pkg-e'], importer);

      expect(records[0]).toMatchObject({ status: 'skipped', code: 'PLUGIN_ENGINE_UNSATISFIED' });
      expect(registry.getAvailable('glossary')).toBeNull();
      expect(warn.mock.calls.flat().join(' ')).toMatch(/PLUGIN_ENGINE_UNSATISFIED pkg-e/);
    } finally {
      warn.mockRestore();
    }
  });

  it('records an import failure without crashing', async () => {
    const registry = new PluginRegistryImpl();
    const importer = fakeImporter({}); // every name rejects

    const { records } = await loadWorkspacePlugins(registry, ['missing-pkg'], importer);

    expect(records[0]).toMatchObject({ status: 'failed', code: 'PLUGIN_IMPORT_FAILED' });
  });

  it('records an invalid manifest as failed', async () => {
    const registry = new PluginRegistryImpl();
    const importer = fakeImporter({ 'pkg-c': { something: 'else' } });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-c'], importer);

    expect(records[0]).toMatchObject({ status: 'failed', code: 'PLUGIN_INVALID_MANIFEST' });
  });

  it('[ac:ac-import-pakietu-ktory-rzucil-zepsut] isolates failures per package — a throwing import and a missing PluginManifest export are skipped with a warning, the others load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new PluginRegistryImpl();
      // `broken` is not in the map → its import() rejects (a broken build);
      // `bad` imports fine but exports no PluginManifest.
      const importer = fakeImporter({
        good: { manifest: manifest({ name: 'good' }) },
        bad: { nope: true },
      });

      const { records } = await loadWorkspacePlugins(registry, ['broken', 'bad', 'good'], importer);

      expect(records.map((r) => [r.package, r.status, r.code])).toEqual([
        ['broken', 'failed', 'PLUGIN_IMPORT_FAILED'],
        ['bad', 'failed', 'PLUGIN_INVALID_MANIFEST'],
        ['good', 'loaded', undefined],
      ]);
      expect(registry.getAvailable('glossary')).not.toBeNull();
      const warned = warn.mock.calls.flat().join('\n');
      expect(warned).toMatch(/PLUGIN_IMPORT_FAILED broken/);
      expect(warned).toMatch(/PLUGIN_INVALID_MANIFEST bad/);
    } finally {
      warn.mockRestore();
    }
  });

  it('[section:m13pool0] two base packages contributing the same entity type — the second is PLUGIN_TYPE_CONFLICT, the first keeps the type, the start goes on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new PluginRegistryImpl();
      const first = entity('glossary');
      const second = { ...entity('glossary'), label: 'Glossary (second)' };
      const importer = fakeImporter({
        'pkg-first': { manifest: manifest({ name: 'first', contributes: { entities: [first] } }) },
        'pkg-second': {
          manifest: manifest({ name: 'second', contributes: { entities: [second, entity('lexicon')] } }),
        },
        'pkg-third': { manifest: manifest({ name: 'third', contributes: { entities: [entity('term')] } }) },
      });

      const { records } = await loadWorkspacePlugins(registry, ['pkg-first', 'pkg-second', 'pkg-third'], importer);

      // A hard error of the second package only: no silent last-wins.
      expect(records.map((r) => [r.package, r.status, r.code])).toEqual([
        ['pkg-first', 'loaded', undefined],
        ['pkg-second', 'failed', 'PLUGIN_TYPE_CONFLICT'],
        ['pkg-third', 'loaded', undefined],
      ]);
      expect(records[1]?.reason).toBe(
        'plugin "second" contributes type "glossary", already registered in the base (by plugin "first")',
      );
      expect(records[1]?.contributedTypes).toBeUndefined();
      // The first registration keeps the slot; the rejected package commits nothing
      // (its second, non-conflicting type is not registered either).
      expect(registry.getAvailable('glossary')?.label).toBe('glossary');
      expect(registry.getAvailable('lexicon')).toBeNull();
      expect(registry.listPluginRecords().map((r) => r.name)).toEqual(['first', 'third']);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/PLUGIN_TYPE_CONFLICT pkg-second/);
    } finally {
      warn.mockRestore();
    }
  });

  it('[section:m13pool0] a manifest declaring one type twice is PLUGIN_TYPE_CONFLICT — nothing of it is registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registry = new PluginRegistryImpl();
      const importer = fakeImporter({
        'pkg-twice': { manifest: manifest({ name: 'twice', contributes: { entities: [entity('glossary'), entity('glossary')] } }) },
      });

      const { records } = await loadWorkspacePlugins(registry, ['pkg-twice'], importer);

      expect(records[0]).toMatchObject({
        status: 'failed',
        code: 'PLUGIN_TYPE_CONFLICT',
        reason: 'plugin "twice" contributes type "glossary" twice',
      });
      expect(registry.getAvailable('glossary')).toBeNull();
      expect(registry.listPluginRecords()).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
