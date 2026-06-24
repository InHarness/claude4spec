import { describe, expect, it, vi } from 'vitest';
import { loadWorkspacePlugins } from './loader.js';
import { PluginRegistryImpl } from './registry.js';
import type { PluginManifest, EntityContribution } from '../../../shared/plugin-host/manifest.js';

function entity(type: string): EntityContribution {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 100,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? type),
    pathPrefix: `/${type}s`,
    serializer: {},
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
    hostApiVersion: '^1.0.0',
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
    // `^1.5.0` needs a newer minor than the 1.0.0 host — unsatisfiable but SAME
    // major, so it is `skipped` (not `incompatible`) with no migration descriptor.
    const importer = fakeImporter({ 'pkg-b': { manifest: manifest({ hostApiVersion: '^1.5.0' }) } });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-b'], importer);

    expect(records[0]).toMatchObject({ status: 'skipped', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(records[0]?.migration).toBeUndefined();
    expect(registry.getAvailable('glossary')).toBeNull();
  });

  it('flags an incompatible MAJOR hostApiVersion as `incompatible` with a migration descriptor', async () => {
    const registry = new PluginRegistryImpl();
    // `^2.0.0` targets a different major — incompatible under the 1.x host.
    const importer = fakeImporter({ 'pkg-old': { manifest: manifest({ hostApiVersion: '^2.0.0' }) } });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-old'], importer);

    expect(records[0]).toMatchObject({ status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(records[0]?.migration?.targetHostApiVersion).toBe('1.1.0');
    // Empty changelog at the 1.x baseline ⇒ no descriptors and no shim.
    expect(records[0]?.migration?.migrations).toHaveLength(0);
    expect(records[0]?.migration?.shimAvailable).toBe(false);
    expect(registry.getAvailable('glossary')).toBeNull();
  });

  it('skips a plugin whose engines.node is unsatisfied', async () => {
    const registry = new PluginRegistryImpl();
    const importer = fakeImporter({
      'pkg-e': { manifest: manifest({ engines: { node: '>=99.0.0' } }) },
    });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-e'], importer);

    expect(records[0]).toMatchObject({ status: 'skipped', code: 'PLUGIN_ENGINE_UNSATISFIED' });
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

  it('isolates failures per package — one bad plugin does not stop the others', async () => {
    const registry = new PluginRegistryImpl();
    const importer = fakeImporter({
      good: { manifest: manifest({ name: 'good' }) },
      bad: { nope: true },
    });

    const { records } = await loadWorkspacePlugins(registry, ['bad', 'good'], importer);

    expect(records.map((r) => r.status)).toEqual(['failed', 'loaded']);
    expect(registry.getAvailable('glossary')).not.toBeNull();
  });
});
