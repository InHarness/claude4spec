/**
 * 2.1.63 — the collision rule of the two-layer pool and its report (M13
 * `m13pool0`), and the prebuilt envelope under a project overlay (M13
 * `m13plenv` „Kolizja z nakładką”).
 *
 *   - `_meta/plugins` reports two axes that are never mixed: the status of each
 *     package (`packages[].status`) and the state of each type of the effective
 *     pool (`types[]`: `active` / `shadowed`, with the origin of both layers);
 *   - an overlay type shadows the base type of the same name — whichever base
 *     envelope carries it, the prebuilt one included;
 *   - a type contributed twice within ONE layer — overlay or base — is
 *     `PLUGIN_TYPE_CONFLICT`; the base's silent last-wins (`Map.set` in
 *     `registerEntityModule`) is gone.
 *
 * The base is the REAL one where it matters: the built-in envelopes loaded by
 * `loadBuiltinEnvelopes`, `diagram` among them from the prebuilt
 * `plugins/c4s-plugin-diagram` (needs the built bundles — `pretest`). The overlay
 * is the real project-local loader over a temporary `<cwd>/.claude4spec/plugins/`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN, fixtureModule } from '../../../../tests/helpers/fixture-module.js';
import type { EntityContribution, PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { buildBasePluginPackages, type PoolTypeState } from './base-packages.js';
import { pluginHostRouter } from './cross-cutting.js';
import { loadBuiltinEnvelopes, loadWorkspacePlugins, type PluginLoadRecord } from './loader.js';
import { PluginTypeConflictError } from './manifest-adapter.js';
import { loadProjectOverlay } from './overlay-loader.js';
import { PluginRegistryImpl } from './registry.js';
import type { ProjectPluginHost } from './types.js';
import { pluginsRouter } from '../../routes/plugins.js';

const PREBUILT = 'c4s-plugin-diagram';
const FROM_SOURCE = 'c4s-plugin-spreadsheets';

function entity(type: string, label = type): EntityContribution {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label,
    labelPlural: `${type}s`,
    pathPrefix: `/${type}s`,
    systemPrompt: { roleNoun: type, mcpToolsLine: `${type}-tools: ...` },
  };
}

function manifest(name: string, entities: EntityContribution[]): PluginManifest {
  return { name, version: '1.0.0', hostApiVersion: '^2.0.0', contributes: { entities } };
}

/** The origin the overlay loader gives a project-local package. */
const local = (pkg: string): string => path.join('.claude4spec', 'plugins', pkg);

let cwd: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-pool-type-state-'));
  // The loaders warn on every refusal; the tests assert the records instead.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  fs.rmSync(cwd, { recursive: true, force: true });
});

/**
 * Load `<cwd>/.claude4spec/plugins/<pkg>` packages through the real overlay
 * loader (the trusted path), each exporting the given manifest.
 */
async function overlayOf(packages: Record<string, PluginManifest>) {
  const modules: Record<string, unknown> = {};
  for (const [pkg, m] of Object.entries(packages)) {
    const dir = path.join(cwd, '.claude4spec', 'plugins', pkg);
    fs.mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, 'index.js');
    fs.writeFileSync(entry, '// fixture');
    modules[pathToFileURL(entry).href] = { manifest: m };
  }
  return loadProjectOverlay(cwd, async (href: string) => {
    const key = href.split('?')[0]!;
    if (key in modules) return modules[key];
    throw new Error(`import failed: ${href}`);
  });
}

interface ProjectMeta {
  packages: PluginLoadRecord[];
  types: PoolTypeState[];
}

/** `GET /_meta/plugins` of one project, as the project router mounts it. */
async function projectMeta(
  host: ProjectPluginHost,
  basePackages: PluginLoadRecord[],
  overlayRecords: PluginLoadRecord[],
): Promise<ProjectMeta> {
  const app = express().use(
    pluginHostRouter({
      host,
      registry: {} as never,
      workspace: {} as never,
      projectId: 'p1',
      basePackages,
      overlayRecords,
      localPluginsPresent: overlayRecords.length > 0,
      trust: overlayRecords.length > 0 ? true : undefined,
    }),
  );
  const res = await request(app).get('/_meta/plugins');
  expect(res.status).toBe(200);
  return res.body as ProjectMeta;
}

const typeState = (meta: ProjectMeta, type: string) => meta.types.find((t) => t.type === type);

describe('[section:m13pool0] _meta/plugins — two axes: plugin status and type state', () => {
  it('[section:m13pool0] _meta/plugins reports the package status and, apart from it, the state of every type of the effective pool (active / shadowed with the origin of both layers); the overlay plugin is `loaded` while the base type it shadows is `shadowed`', async () => {
    const registry = new PluginRegistryImpl();
    const { records: baseRecords } = await loadWorkspacePlugins(registry, ['@acme/api'], async () => ({
      manifest: manifest('@acme/api', [entity('endpoint'), entity('dto')]),
    }));
    const overlay = await overlayOf({
      'endpoint-next': manifest('@local/endpoint-next', [entity('endpoint', 'Endpoint (next)'), entity('glossary')]),
    });
    expect(overlay.overlay).toBeDefined();
    const host = registry.consolidate(null, overlay.overlay);
    const basePackages = buildBasePluginPackages(registry, baseRecords);

    const meta = await projectMeta(host, basePackages, overlay.records);

    // Axis 1 — package status: both packages entered their layer.
    const byPkg = new Map(meta.packages.map((p) => [p.package, p]));
    expect(byPkg.get('@acme/api')).toMatchObject({ status: 'loaded', layer: 'base' });
    expect(byPkg.get('endpoint-next')).toMatchObject({ status: 'loaded', layer: 'overlay' });

    // Axis 2 — type state: one entry per type of the effective pool, each with
    // the origin of the layer(s) that contribute it.
    expect(meta.types).toEqual([
      { type: 'dto', state: 'active', origin: { base: '@acme/api' } },
      { type: 'endpoint', state: 'shadowed', origin: { base: '@acme/api', overlay: local('endpoint-next') } },
      { type: 'glossary', state: 'active', origin: { overlay: local('endpoint-next') } },
    ]);
    // Both true at once — and never mixed: no package carries a type state, no
    // type carries a package status.
    expect(byPkg.get('endpoint-next')?.status).toBe('loaded');
    expect(typeState(meta, 'endpoint')?.state).toBe('shadowed');
    expect(meta.packages.map((p) => p.status)).not.toContain('shadowed');
    expect(meta.types.map((t) => t.state).every((s) => s === 'active' || s === 'shadowed')).toBe(true);
    // Shadowing is a report, not activation: the type stays active, backed by the overlay.
    expect(host.partition().active).toContain('endpoint');
    expect(host.getAvailable('endpoint')?.label).toBe('Endpoint (next)');

    // The process-global route reports the base alone, where nothing is shadowed.
    const globalApp = express().use(
      '/api',
      pluginsRouter({ pluginRegistry: registry, pluginRecords: baseRecords, resolveWorkspaceRoot: () => null }),
    );
    const global = await request(globalApp).get('/api/_meta/plugins').expect(200);
    expect(global.body.types).toEqual([
      { type: 'dto', state: 'active', origin: { base: '@acme/api' } },
      { type: 'endpoint', state: 'active', origin: { base: '@acme/api' } },
    ]);
  });
});

describe('the real base: built-in envelopes, the prebuilt one included', () => {
  let registry: PluginRegistryImpl;
  let envelopeRecords: PluginLoadRecord[];

  beforeAll(async () => {
    registry = new PluginRegistryImpl();
    envelopeRecords = (await loadBuiltinEnvelopes(registry)).records;
  }, 60_000);

  it('[section:m13pool0] an overlay type shadows the base type of the same name — an envelope built from source and the prebuilt envelope alike', async () => {
    expect(envelopeRecords.find((r) => r.package === FROM_SOURCE)).toMatchObject({ status: 'loaded' });
    expect(envelopeRecords.find((r) => r.package === PREBUILT)).toMatchObject({
      status: 'loaded',
      contributedTypes: ['diagram'],
    });
    const baseSpreadsheet = registry.getAvailable('spreadsheet');
    const baseDiagram = registry.getAvailable('diagram');
    expect(baseSpreadsheet).not.toBeNull();
    expect(baseDiagram).not.toBeNull();

    const overlay = await overlayOf({
      'next-types': manifest('@local/next-types', [entity('spreadsheet', 'Sheet (next)'), entity('diagram', 'Diagram (next)')]),
    });
    expect(overlay.records[0]).toMatchObject({ status: 'loaded', contributedTypes: ['spreadsheet', 'diagram'] });
    const host = registry.consolidate(null, overlay.overlay);

    // The overlay module backs both types in this project's effective pool…
    expect(host.getAvailable('spreadsheet')?.label).toBe('Sheet (next)');
    expect(host.getAvailable('diagram')?.label).toBe('Diagram (next)');
    expect(host.listAvailable().filter((m) => m.type === 'diagram')).toHaveLength(1);
    // …and the base keeps its own modules: shadowing changes nothing in the base.
    expect(registry.getAvailable('spreadsheet')).toBe(baseSpreadsheet);
    expect(registry.getAvailable('diagram')).toBe(baseDiagram);

    const meta = await projectMeta(host, buildBasePluginPackages(registry, envelopeRecords), overlay.records);
    expect(typeState(meta, 'spreadsheet')).toEqual({
      type: 'spreadsheet',
      state: 'shadowed',
      origin: { base: FROM_SOURCE, overlay: local('next-types') },
    });
    expect(typeState(meta, 'diagram')).toEqual({
      type: 'diagram',
      state: 'shadowed',
      origin: { base: PREBUILT, overlay: local('next-types') },
    });
    // A base type the overlay does not touch stays `active`, from its envelope.
    expect(typeState(meta, 'endpoint')).toEqual({
      type: 'endpoint',
      state: 'active',
      origin: { base: 'c4s-plugin-api-contracts' },
    });
  });

  it('[section:m13plenv] a project overlay contributing the type of the prebuilt envelope shadows it in THAT project only — another project of the same process still has the envelope\'s module', async () => {
    const baseDiagram = registry.getAvailable('diagram');
    const overlay = await overlayOf({ 'diagram-next': manifest('@local/diagram-next', [entity('diagram', 'Diagram (next)')]) });
    const basePackages = buildBasePluginPackages(registry, envelopeRecords);

    // Project A carries the overlay (e.g. the plugin's repository developing its
    // next version), project B does not — same process, same base.
    const projectA = registry.consolidate(null, overlay.overlay);
    const projectB = registry.consolidate(null);

    expect(projectA.getAvailable('diagram')?.label).toBe('Diagram (next)');
    expect(projectB.getAvailable('diagram')).toBe(baseDiagram);
    // Still active in both: the overlay replaces the module, not the activation.
    expect(projectA.isActive('diagram')).toBe(true);
    expect(projectB.isActive('diagram')).toBe(true);

    const metaA = await projectMeta(projectA, basePackages, overlay.records);
    const metaB = await projectMeta(projectB, basePackages, []);
    expect(typeState(metaA, 'diagram')).toEqual({
      type: 'diagram',
      state: 'shadowed',
      origin: { base: PREBUILT, overlay: local('diagram-next') },
    });
    expect(typeState(metaB, 'diagram')).toEqual({ type: 'diagram', state: 'active', origin: { base: PREBUILT } });
    // The prebuilt envelope itself stays `loaded` in both projects — the
    // shadowing is on the type axis, not the package axis.
    for (const meta of [metaA, metaB]) {
      expect(meta.packages.find((p) => p.package === PREBUILT)?.status).toBe('loaded');
    }
  });

  it('[section:m13pool0] a duplicate type within the base is PLUGIN_TYPE_CONFLICT — a workspace package contributing the prebuilt envelope\'s type is refused, the envelope keeps it', async () => {
    const baseDiagram = registry.getAvailable('diagram');
    const { records } = await loadWorkspacePlugins(registry, ['@acme/diagram-fork'], async () => ({
      manifest: manifest('@acme/diagram-fork', [entity('diagram', 'Diagram (fork)')]),
    }));

    expect(records[0]).toMatchObject({ package: '@acme/diagram-fork', status: 'failed', code: 'PLUGIN_TYPE_CONFLICT' });
    expect(records[0]?.reason).toContain('type "diagram", already registered in the base');
    expect(registry.getAvailable('diagram')).toBe(baseDiagram);
    expect(registry.listPluginRecords().some((r) => r.name === '@acme/diagram-fork')).toBe(false);
  });
});

describe('[section:m13pool0] a duplicate type within one layer is PLUGIN_TYPE_CONFLICT', () => {
  it('[section:m13pool0] in the base: registerEntityModule with a type already registered throws PLUGIN_TYPE_CONFLICT — no silent last-wins Map.set; the first module stays', () => {
    const registry = new PluginRegistryImpl();
    const first = fixtureModule('glossary');
    registry.registerEntityModule(first);

    let thrown: unknown;
    try {
      registry.registerEntityModule({ ...fixtureModule('glossary'), label: 'Glossary (second)' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PluginTypeConflictError);
    expect(thrown).toMatchObject({ code: 'PLUGIN_TYPE_CONFLICT', type: 'glossary' });
    expect((thrown as Error).message).toBe(
      'PLUGIN_TYPE_CONFLICT: type "glossary" is already registered in the base (direct registration)',
    );
    expect(registry.getAvailable('glossary')?.label).toBe('glossary');
    expect(registry.listAvailable().filter((m) => m.type === 'glossary')).toHaveLength(1);
  });

  it('[section:m13pool0] in the overlay: a second project-local plugin with the same type, and one plugin declaring a type twice, are PLUGIN_TYPE_CONFLICT', async () => {
    const overlay = await overlayOf({
      'a-pkg': manifest('@local/a', [entity('glossary')]),
      'b-pkg': manifest('@local/b', [entity('glossary', 'Glossary (b)')]),
      'c-pkg': manifest('@local/c', [entity('term'), entity('term', 'Term (again)')]),
    });

    const byPkg = new Map(overlay.records.map((r) => [r.package, r]));
    expect(byPkg.get('a-pkg')).toMatchObject({ status: 'loaded' });
    expect(byPkg.get('b-pkg')).toMatchObject({ status: 'failed', code: 'PLUGIN_TYPE_CONFLICT' });
    expect(byPkg.get('c-pkg')).toMatchObject({
      status: 'failed',
      code: 'PLUGIN_TYPE_CONFLICT',
      reason: 'type "term" is contributed twice by this project-local plugin',
    });
    // The overlay stays unambiguous: one module per type, the first one.
    expect(overlay.overlay?.listLocal().map((m) => [m.type, m.label])).toEqual([['glossary', 'glossary']]);
  });
});
