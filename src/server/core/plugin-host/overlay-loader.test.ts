import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  enumerateOverlayPackages,
  hasProjectPlugins,
  loadProjectOverlay,
} from './overlay-loader.js';
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
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
  };
}

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: '@local/c4s-plugin',
    version: '1.0.0',
    hostApiVersion: '^1.0.0',
    onUnregister: () => {},
    contributes: { entities: [entity('glossary')] },
    ...over,
  };
}

describe('overlay-loader', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-overlay-'));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  /** Create `<cwd>/.claude4spec/plugins/<pkg>/index.js` and return its file URL. */
  function makePkg(pkg: string): string {
    const dir = path.join(cwd, '.claude4spec', 'plugins', pkg);
    fs.mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, 'index.js');
    fs.writeFileSync(entry, '// fixture');
    return pathToFileURL(entry).href;
  }

  /** Fake importer keyed by resolved file URL href (ignores the `?v=` cache-bust). */
  function fakeImporter(modules: Record<string, unknown>) {
    return vi.fn(async (href: string) => {
      const key = href.split('?')[0];
      if (key in modules) return modules[key];
      throw new Error(`import failed: ${href}`);
    });
  }

  it('absent plugins dir ⇒ undefined overlay, no records', async () => {
    expect(hasProjectPlugins(cwd)).toBe(false);
    const res = await loadProjectOverlay(cwd, fakeImporter({}));
    expect(res.overlay).toBeUndefined();
    expect(res.records).toEqual([]);
  });

  it('resolves an entry from conditional exports (no top-level main/module)', async () => {
    const dir = path.join(cwd, '.claude4spec', 'plugins', 'exports-pkg');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'exports-pkg', type: 'module', exports: { '.': { import: './lib/entry.mjs' } } }),
    );
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    const entry = path.join(dir, 'lib', 'entry.mjs');
    fs.writeFileSync(entry, '// fixture');
    const url = pathToFileURL(entry).href;

    const res = await loadProjectOverlay(cwd, fakeImporter({ [url]: { manifest: manifest() } }));
    expect(res.records[0]).toMatchObject({ package: 'exports-pkg', status: 'loaded' });
    expect(res.overlay?.listLocal().map((m) => m.type)).toEqual(['glossary']);
  });

  it('loads a valid project-local plugin as a trusted overlay', async () => {
    const url = makePkg('glossary-pkg');
    expect(enumerateOverlayPackages(cwd)).toEqual(['glossary-pkg']);

    const res = await loadProjectOverlay(cwd, fakeImporter({ [url]: { manifest: manifest() } }));

    expect(res.records[0]).toMatchObject({
      package: 'glossary-pkg',
      status: 'loaded',
      layer: 'overlay',
      trust: 'trusted',
      contributedTypes: ['glossary'],
      origin: path.join('.claude4spec', 'plugins', 'glossary-pkg'),
    });
    expect(res.overlay?.listLocal().map((m) => m.type)).toEqual(['glossary']);
    expect(res.overlay?.origin('glossary')).toBe(path.join('.claude4spec', 'plugins', 'glossary-pkg'));
  });

  it('rejects the second project-local plugin that re-declares a type (PLUGIN_TYPE_CONFLICT)', async () => {
    const urlA = makePkg('a-pkg');
    const urlB = makePkg('b-pkg');
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({
        [urlA]: { manifest: manifest({ name: 'a' }) },
        [urlB]: { manifest: manifest({ name: 'b' }) }, // also contributes 'glossary'
      }),
    );

    expect(res.records.find((r) => r.package === 'a-pkg')?.status).toBe('loaded');
    expect(res.records.find((r) => r.package === 'b-pkg')).toMatchObject({
      status: 'failed',
      code: 'PLUGIN_TYPE_CONFLICT',
    });
    // The overlay stays unambiguous — only the first 'glossary' survives.
    expect(res.overlay?.listLocal().map((m) => m.type)).toEqual(['glossary']);
  });

  it('reports an incompatible-major hostApiVersion as `incompatible` with a migration descriptor', async () => {
    const url = makePkg('future-pkg');
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({ [url]: { manifest: manifest({ hostApiVersion: '^99.0.0' }) } }),
    );
    expect(res.records[0]).toMatchObject({ status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' });
    expect(res.records[0]?.migration?.targetHostApiVersion).toBe('1.0.0');
    expect(res.overlay).toBeUndefined();
  });

  it('isolates a failing plugin from a good one', async () => {
    const urlGood = makePkg('good');
    makePkg('bad'); // entry exists, but importer rejects its URL
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({ [urlGood]: { manifest: manifest({ name: 'good' }) } }),
    );
    const byPkg = Object.fromEntries(res.records.map((r) => [r.package, r.status]));
    expect(byPkg).toEqual({ bad: 'failed', good: 'loaded' });
    expect(res.overlay?.listLocal().map((m) => m.type)).toEqual(['glossary']);
  });

  // M13: an overlay entity authored with the declarative backend.{service,
  // crud,routes,mcpServer} style must get an equivalent `mount` synthesized —
  // regression coverage for a bug found by code review, where only the
  // base-layer registry path (registerEntityModule) applied synthesizeMount
  // and the overlay path silently left such an entity inert (no mount at all).
  it('synthesizes a mount for a declarative overlay entity (service/crud/routes)', async () => {
    const url = makePkg('declarative-pkg');
    const declarativeEntity: EntityContribution = {
      ...entity('widget'),
      backend: {
        service: () => ({}) as never,
        crud: { createSchema: {} },
        routes: { router: () => ({}) as never },
      },
    };
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({ [url]: { manifest: manifest({ contributes: { entities: [declarativeEntity] } }) } }),
    );
    expect(res.records[0]).toMatchObject({ status: 'loaded' });
    const mod = res.overlay?.listLocal().find((m) => m.type === 'widget');
    expect(typeof mod?.backend?.mount).toBe('function');
  });

  // Same bug class: crud declared without service must be REJECTED at load
  // time (PLUGIN_INVALID_MANIFEST), not silently registered with no mount.
  it('rejects an overlay entity declaring crud without service', async () => {
    const url = makePkg('invalid-pkg');
    const invalidEntity: EntityContribution = {
      ...entity('widget'),
      backend: { crud: { createSchema: {} } }, // no `service`
    };
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({ [url]: { manifest: manifest({ contributes: { entities: [invalidEntity] } }) } }),
    );
    expect(res.records[0]).toMatchObject({ status: 'failed', code: 'PLUGIN_INVALID_MANIFEST' });
    expect(res.overlay?.listLocal() ?? []).toEqual([]);
  });
});
