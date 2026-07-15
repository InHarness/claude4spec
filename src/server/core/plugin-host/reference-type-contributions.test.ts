import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginRegistryImpl } from './registry.js';
import { loadWorkspacePlugins } from './loader.js';
import { loadProjectOverlay } from './overlay-loader.js';
import { clearExtensionReferenceTypes, getExtensionReferenceType } from '../../../shared/reference-extensions.js';
import type { EntityContribution, PluginManifest } from '../../../shared/plugin-host/manifest.js';
import type { BackendModule } from './types.js';

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
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
  };
}

/**
 * v0.1.129 (M19 extensible reference types) — the two declarative
 * contribution slots (A: `PluginManifest.contributes.referenceTypes[]`, B:
 * `EntityModule.frontend.referenceType`) both fan out to the same
 * process-global `shared/reference-extensions.ts` registry, which now fails
 * fast on a genuine duplicate tag. These tests cover: Slot A/B dispatch, the
 * `entityType` auto-injection Slot B performs, and that a duplicate-tag
 * conflict is contained per-package (never crashes the whole load) at both
 * the base and overlay loader layers.
 */

function manifestWithRefType(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: '@acme/c4s-plugin-figure',
    version: '1.0.0',
    hostApiVersion: '^1.0.0',
    onUnregister: () => {},
    contributes: {
      referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id', 'caption'] }],
    },
    ...over,
  };
}

function widgetModule(refTag?: string): BackendModule {
  return {
    type: 'widget',
    table: 'widget',
    label: 'Widget',
    labelPlural: 'Widgets',
    displayOrder: 100,
    slugFrom: () => 'widget-x',
    pathPrefix: '/widgets',
    serializer: {} as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: 'widget',
      countStat: { placeholder: 'widgetCount', sqlQuery: 'SELECT 0 AS count', label: 'widget' },
    },
    ...(refTag
      ? { frontend: { referenceType: { tag: refTag, attrOrder: ['slug'] } } }
      : {}),
  };
}

beforeEach(() => {
  clearExtensionReferenceTypes();
});
afterEach(() => {
  clearExtensionReferenceTypes();
});

describe('Slot B — BackendModule.frontend.referenceType', () => {
  it('registerEntityModule forwards frontend.referenceType, auto-injecting entityType = module.type', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(widgetModule('widget_ref'));

    expect(getExtensionReferenceType('widget_ref')).toEqual({
      tag: 'widget_ref',
      attrOrder: ['slug'],
      entityType: 'widget',
    });
  });

  it('a module with no frontend.referenceType registers no M19 tag', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(widgetModule());
    expect(getExtensionReferenceType('widget_ref')).toBeUndefined();
  });
});

describe('Slot A — PluginManifest.contributes.referenceTypes', () => {
  it('registerPlugin dispatches contributes.referenceTypes to the M19 registry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifestWithRefType());
    expect(getExtensionReferenceType('figure_ref')).toEqual({ tag: 'figure_ref', attrOrder: ['id', 'caption'] });
  });

  it('base tier: a duplicate-tag conflict fails only the offending package (loadWorkspacePlugins)', async () => {
    const registry = new PluginRegistryImpl();
    const importer = vi.fn(async (specifier: string) => {
      // pkg-b's `figure_ref` has a DIFFERENT attrOrder — a genuine conflict, not
      // a benign identical re-registration (which is a documented no-op, see
      // reference-extensions.test.ts).
      const modules: Record<string, unknown> = {
        'pkg-a': { manifest: manifestWithRefType({ name: 'a' }) },
        'pkg-b': {
          manifest: manifestWithRefType({
            name: 'b',
            contributes: { referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id'] }] },
          }),
        },
      };
      if (specifier in modules) return modules[specifier];
      throw new Error('not found');
    });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-a', 'pkg-b'], importer);

    expect(records.find((r) => r.package === 'pkg-a')?.status).toBe('loaded');
    const bRecord = records.find((r) => r.package === 'pkg-b');
    expect(bRecord?.status).toBe('failed');
    expect(bRecord?.reason).toMatch(/already registered/);
    // The first package's registration survives; the process never crashed.
    expect(getExtensionReferenceType('figure_ref')).toMatchObject({ tag: 'figure_ref' });
  });
});

describe('registerPlugin atomicity — a reference-type conflict rolls back the WHOLE manifest, not just the tag', () => {
  it('a Slot A conflict leaves the manifest\'s entity modules unregistered too (no split-brain "package failed but entity is live")', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifestWithRefType({ name: '@acme/base-figure' })); // claims figure_ref first

    const conflicting = manifestWithRefType({
      name: '@acme/plugin-with-entity-and-conflict',
      contributes: {
        entities: [entity('gadget')],
        referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id'] }], // different attrOrder ⇒ genuine conflict
      },
    });

    expect(() => registry.registerPlugin(conflicting)).toThrow(/already registered/);

    // Neither the entity type nor the plugin record were committed — a
    // process restart is NOT required to recover, and a later call to
    // unregisterPlugin('@acme/plugin-with-entity-and-conflict') would have
    // been a no-op against orphaned state before this fix.
    expect(registry.getAvailable('gadget')).toBeNull();
    expect(registry.listPluginRecords().map((r) => r.name)).toEqual(['@acme/base-figure']);
    // The original tag is untouched by the failed attempt.
    expect(getExtensionReferenceType('figure_ref')).toEqual({ tag: 'figure_ref', attrOrder: ['id', 'caption'] });
  });

  it('two referenceTypes entries in the SAME manifest that redeclare the same tag differently both fail atomically', () => {
    const registry = new PluginRegistryImpl();
    const manifest = manifestWithRefType({
      name: '@acme/self-conflicting',
      contributes: {
        entities: [entity('gadget')],
        referenceTypes: [
          { tag: 'figure_ref', attrOrder: ['id'] },
          { tag: 'figure_ref', attrOrder: ['id', 'caption'] },
        ],
      },
    });

    expect(() => registry.registerPlugin(manifest)).toThrow(/declared twice with different definitions/);
    expect(registry.getAvailable('gadget')).toBeNull();
    expect(getExtensionReferenceType('figure_ref')).toBeUndefined();
  });
});

describe('overlay tier — contributes.referenceTypes duplicate-tag fail-soft', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-overlay-reftype-'));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function makePkg(pkg: string): string {
    const dir = path.join(cwd, '.claude4spec', 'plugins', pkg);
    fs.mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, 'index.js');
    fs.writeFileSync(entry, '// fixture');
    return pathToFileURL(entry).href;
  }

  function fakeImporter(modules: Record<string, unknown>) {
    return vi.fn(async (href: string) => {
      const key = href.split('?')[0];
      if (key in modules) return modules[key];
      throw new Error(`import failed: ${href}`);
    });
  }

  it('the second project-local plugin re-declaring the same reference tag with a different spec fails soft, per package', async () => {
    // A base-tier plugin already claimed 'figure_ref' — simulates a base/overlay
    // collision. Different attrOrder ⇒ a genuine conflict, not the benign
    // identical-re-registration no-op.
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifestWithRefType({ name: '@acme/base-figure' }));

    const urlA = makePkg('a-pkg');
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({
        [urlA]: {
          manifest: manifestWithRefType({
            name: 'a-local',
            contributes: { referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id'] }] },
          }),
        },
      }),
    );

    expect(res.records[0]).toMatchObject({ package: 'a-pkg', status: 'failed', code: 'PLUGIN_INVALID_MANIFEST' });
    expect(res.records[0]?.reason).toMatch(/already registered/);
    // The overlay never partially committed this package's entity modules.
    expect(res.overlay?.listLocal() ?? []).toEqual([]);
  });
});
