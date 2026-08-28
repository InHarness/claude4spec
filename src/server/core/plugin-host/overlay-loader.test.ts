import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
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
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 100,
    pathPrefix: `/${type}s`,
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
    hostApiVersion: '^2.0.0',
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

  /**
   * A subagent-only package has no entities, no settings and no commands, so it would fall
   * through the "no capabilities at all" early return and be dropped in silence — the same
   * trap `commands` had to be added to that test for.
   */
  it('a subagent-only project-local package still produces an overlay', async () => {
    const url = makePkg('subagent-pkg');
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({
        [url]: {
          manifest: {
            name: '@local/subagent-only',
            version: '1.0.0',
            hostApiVersion: '^2.0.0',
            contributes: {
              subagents: [
                {
                  name: 'domain-explore',
                  description: 'Explores the domain.',
                  promptBody: 'Body.',
                  tools: ['mcp__reference-tools__get_page'],
                },
              ],
            },
          },
        },
      }),
    );
    expect(res.records[0]).toMatchObject({ package: 'subagent-pkg', status: 'loaded' });
    expect(res.overlay).toBeDefined();
    expect(res.overlay?.listSubagents().map((c) => c.name)).toEqual(['domain-explore']);
    expect(res.overlay?.listLocal()).toEqual([]);
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
    expect(res.records[0]?.migration?.targetHostApiVersion).toBe('2.0.0');
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

  /**
   * 2.0.0 tier K — this used to assert PLUGIN_INVALID_MANIFEST. A custom MCP
   * server with no `service` is now the ordinary case for a declarative type
   * (the tool needs the manifest and the reader, not a CRUD object), so the
   * overlay must LOAD it. Reversed rather than deleted: the file is where
   * "which manifests does the loader accept" is pinned, and silently dropping
   * the case would leave that question unanswered for the shape plugins now
   * actually ship.
   */
  it('loads an overlay entity declaring mcpServer without service', async () => {
    const url = makePkg('mcp-only-pkg');
    const mcpOnlyEntity: EntityContribution = {
      ...entity('widget'),
      backend: { mcpServer: () => ({}) as never }, // no `service`
    };
    const res = await loadProjectOverlay(
      cwd,
      fakeImporter({ [url]: { manifest: manifest({ contributes: { entities: [mcpOnlyEntity] } }) } }),
    );
    expect(res.records[0]).toMatchObject({ status: 'loaded' });
    const mod = res.overlay?.listLocal().find((m) => m.type === 'widget');
    expect(typeof mod?.backend?.mount).toBe('function');
  });
});
