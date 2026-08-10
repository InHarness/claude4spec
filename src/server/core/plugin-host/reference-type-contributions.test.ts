import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginRegistryImpl } from './registry.js';
import { loadWorkspacePlugins } from './loader.js';
import { loadProjectOverlay } from './overlay-loader.js';
import {
  clearExtensionReferenceTypes,
  getExtensionReferenceType,
  listExtensionReferenceTypes,
} from '../../../shared/reference-extensions.js';
import type { EntityContribution, PluginManifest } from '../../../shared/plugin-host/manifest.js';
import type { BackendModule } from './types.js';

/**
 * 0.2.15 — this file used to cover the two declarative reference-type
 * contribution slots (A: `PluginManifest.contributes.referenceTypes[]`,
 * B: `EntityModule.frontend.referenceType`), their fan-out to the M19 registry,
 * the `entityType` auto-injection, and the batch atomicity that a manifest
 * carrying both needed.
 *
 * BOTH SLOTS ARE GONE, and so is everything that only existed to serve them.
 * What is worth pinning now is the absence itself — that no door from a plugin
 * or an entity module into the M19 registry survives — because the failure mode
 * of a half-removal is silent: a tag that still registers is a tag that still
 * parses, and nobody notices until two plugins collide over one.
 *
 * The registry's own conflict / no-op / shadowing semantics still exist and are
 * covered where they live, in `shared/reference-extensions.test.ts`.
 */

function entity(type: string): EntityContribution {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 100,
    pathPrefix: `/${type}s`,
    serializer: {},
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
  };
}

function widgetModule(): BackendModule {
  return {
    type: 'widget',
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: 'Widget',
    labelPlural: 'Widgets',
    displayOrder: 100,
    pathPrefix: '/widgets',
    serializer: {} as BackendModule['serializer'],
    systemPrompt: { roleNoun: 'widget' },
  };
}

/**
 * A manifest as a plugin written against 2.0.x would still ship it — declaring
 * the slot that no longer exists. Typed loosely on purpose: `contributes` has no
 * `referenceTypes` key any more, which is the point of the test.
 */
function staleManifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: '@acme/c4s-plugin-figure',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    onUnregister: () => {},
    contributes: {
      referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id', 'caption'] }],
    } as PluginManifest['contributes'],
    ...over,
  };
}

beforeEach(() => {
  clearExtensionReferenceTypes();
});
afterEach(() => {
  clearExtensionReferenceTypes();
});

describe('an entity module contributes no XML tag', () => {
  it('registerEntityModule registers nothing in the M19 registry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(widgetModule());
    expect(listExtensionReferenceTypes()).toEqual([]);
  });

  it('registerPlugin registers nothing in the M19 registry, entities and all', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(staleManifest({ contributes: { entities: [entity('gadget')] } }));
    expect(registry.getAvailable('gadget')).not.toBeNull();
    expect(listExtensionReferenceTypes()).toEqual([]);
  });
});

describe('a 2.x plugin still declaring contributes.referenceTypes', () => {
  /**
   * The deliberate consequence of NOT bumping `HOST_API_VERSION` for this
   * removal: the plugin keeps loading, and its declaration is inert. The
   * alternative — a major bump — would reject it outright with a migration
   * message. Both are defensible; this test records which one shipped, so the
   * decision cannot be reversed by accident.
   */
  it('loads normally, and its declared tag is simply never registered', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(staleManifest());
    expect(registry.listPluginRecords().map((r) => r.name)).toEqual(['@acme/c4s-plugin-figure']);
    expect(getExtensionReferenceType('figure_ref')).toBeUndefined();
  });

  it('base tier: two packages declaring the SAME tag no longer collide, because neither registers it', async () => {
    const registry = new PluginRegistryImpl();
    const importer = vi.fn(async (specifier: string) => {
      const modules: Record<string, unknown> = {
        'pkg-a': { manifest: staleManifest({ name: 'a' }) },
        'pkg-b': {
          manifest: staleManifest({
            name: 'b',
            contributes: { referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id'] }] } as PluginManifest['contributes'],
          }),
        },
      };
      if (specifier in modules) return modules[specifier];
      throw new Error('not found');
    });

    const { records } = await loadWorkspacePlugins(registry, ['pkg-a', 'pkg-b'], importer);

    expect(records.map((r) => r.status)).toEqual(['loaded', 'loaded']);
    expect(getExtensionReferenceType('figure_ref')).toBeUndefined();
  });
});

describe('overlay tier — a project-local plugin cannot register a tag either', () => {
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

  it('loads the package and ignores its reference-type declaration', async () => {
    const urlA = makePkg('a-pkg');
    const res = await loadProjectOverlay(
      cwd,
      vi.fn(async (href: string) => {
        const key = href.split('?')[0];
        if (key === urlA) {
          return {
            manifest: staleManifest({
              name: 'a-local',
              contributes: {
                entities: [entity('gadget')],
                referenceTypes: [{ tag: 'figure_ref', attrOrder: ['id'] }],
              } as PluginManifest['contributes'],
            }),
          };
        }
        throw new Error(`import failed: ${href}`);
      }),
    );

    expect(res.records[0]).toMatchObject({ package: 'a-pkg', status: 'loaded' });
    expect(getExtensionReferenceType('figure_ref')).toBeUndefined();
  });
});
