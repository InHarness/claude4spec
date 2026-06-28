import { describe, expect, it } from 'vitest';
import { getEntityDef } from './registry.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import type { FrontendModule } from '../core/plugin-host/types.js';

// Regression: plugin-contributed entity types register only into the client
// plugin host (via registerFrontendModule), never into the legacy `registry`
// map. `getEntityDef` must therefore resolve from the host, or `<single_element
// type="database-table" .../>` and friends render the "unknown type" broken chip
// for every plugin entity type. See the database-table plugin bug.
describe('getEntityDef resolves plugin-host-registered types', () => {
  const Noop = (() => null) as unknown as FrontendModule['renderCard'];
  const fakeModule = {
    type: 'test-plugin-entity',
    table: 'test_plugin_entity',
    label: 'Test Plugin Entity',
    labelPlural: 'Test Plugin Entities',
    displayOrder: 500,
    pathPrefix: '/test-plugin-entities',
    slugFrom: () => 'x',
    renderChip: Noop,
    renderCard: Noop,
    renderRow: Noop,
    detailPanel: Noop,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;

  it('returns the module for a type registered only in the plugin host', () => {
    clientPluginHost.registerFrontendModule(fakeModule);
    const def = getEntityDef('test-plugin-entity');
    expect(def).not.toBeNull();
    expect(def?.label).toBe('Test Plugin Entity');
    expect(def?.renderCard).toBe(Noop);
  });

  it('returns null for an unregistered type', () => {
    expect(getEntityDef('definitely-not-registered')).toBeNull();
  });
});
