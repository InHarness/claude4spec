import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import type { BackendModule, ProjectPluginOverlay } from './types.js';

/** Minimal BackendModule for pool/activation assertions. */
function mod(type: string, displayOrder = 100): BackendModule {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? type),
    pathPrefix: `/${type}s`,
    serializer: {} as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
  };
}

function baseRegistry(...types: string[]): PluginRegistryImpl {
  const registry = new PluginRegistryImpl();
  for (const t of types) registry.registerEntityModule(mod(t));
  return registry;
}

function overlayOf(modules: BackendModule[]): ProjectPluginOverlay {
  return {
    listLocal: () => modules,
    origin: (type) => `.claude4spec/plugins/${type}-pkg`,
    listSettings: () => [],
    listCommands: () => [],
  };
}

describe('consolidate — overlay', () => {
  it('overlay undefined ⇒ effective pool = base', () => {
    const host = baseRegistry('endpoint', 'dto').consolidate({});
    expect(host.listAvailable().map((m) => m.type).sort()).toEqual(['dto', 'endpoint']);
    expect(host.shadowReport()).toEqual([]);
  });

  it('merges base ∪ overlay into the effective pool', () => {
    const host = baseRegistry('endpoint').consolidate({}, overlayOf([mod('glossary')]));
    expect(host.listAvailable().map((m) => m.type).sort()).toEqual(['endpoint', 'glossary']);
    expect(host.getAvailable('glossary')).not.toBeNull();
  });

  it('overlay shadows a same-typed base module (cross-layer) and reports it', () => {
    const baseEndpoint = mod('endpoint', 1);
    const overlayEndpoint = mod('endpoint', 2);
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(baseEndpoint);
    const host = registry.consolidate({}, overlayOf([overlayEndpoint]));

    // The overlay module wins the lookup.
    expect(host.getAvailable('endpoint')).toBe(overlayEndpoint);
    expect(host.listAvailable().filter((m) => m.type === 'endpoint')).toHaveLength(1);
    expect(host.shadowReport()).toEqual([
      { type: 'endpoint', overlayOrigin: '.claude4spec/plugins/endpoint-pkg' },
    ]);
  });

  it('an overlay-only type carries no shadow entry', () => {
    const host = baseRegistry('endpoint').consolidate({}, overlayOf([mod('glossary')]));
    expect(host.shadowReport()).toEqual([]);
  });

  it('applies the entities whitelist to the merged pool (overlay types activatable)', () => {
    const host = baseRegistry('endpoint', 'dto').consolidate(
      { entities: ['glossary'] },
      overlayOf([mod('glossary')]),
    );
    const part = host.partition();
    expect(part.active).toEqual(['glossary']);
    expect(part.inactive.sort()).toEqual(['dto', 'endpoint']);
    expect(part.unknown).toEqual([]);
    expect(host.isActive('glossary')).toBe(true);
  });

  it('a whitelist entry in neither layer is unknown', () => {
    const host = baseRegistry('endpoint').consolidate(
      { entities: ['endpoint', 'ghost'] },
      overlayOf([mod('glossary')]),
    );
    expect(host.partition().unknown).toEqual(['ghost']);
  });
});
