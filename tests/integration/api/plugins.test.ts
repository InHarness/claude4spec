import { describe, expect, it, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/core/plugin-host/register-builtins.js';
import { pluginsRouter } from '../../../src/server/routes/plugins.js';
import { HOST_API_VERSION, type PluginManifest } from '../../../src/shared/plugin-host/manifest.js';
import { loadWorkspacePlugins } from '../../../src/server/core/plugin-host/loader.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../helpers/fixture-module.js';

function makeApp(records: Parameters<typeof pluginsRouter>[0]['pluginRecords'] = []) {
  const pluginRegistry = new PluginRegistryImpl();
  registerAllPlugins(pluginRegistry);
  const app = express();
  app.use('/api', pluginsRouter({ pluginRegistry, pluginRecords: records }));
  return app;
}

describe('M33 plugins router', () => {
  let app: express.Express;
  beforeEach(() => {
    app = makeApp();
  });

  it('GET /api/plugins/frontend-manifest returns the import map + empty plugins (phase 1)', async () => {
    const res = await request(app).get('/api/plugins/frontend-manifest').expect(200);
    expect(res.body.hostApiVersion).toBe(HOST_API_VERSION);
    expect(res.body.plugins).toEqual([]);
    expect(res.body.importMap.react).toBe('/api/plugins/runtime/react.js');
    expect(res.body.importMap['@c4s/plugin-runtime']).toBe('/api/plugins/runtime/plugin-runtime.js');
  });

  it('GET /api/plugins/runtime/react.js serves ESM reading the host singleton', async () => {
    const res = await request(app).get('/api/plugins/runtime/react.js').expect(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('globalThis.__c4s_shared');
    expect(res.text).toContain('export default');
  });

  it('GET /api/plugins/runtime/<unknown>.js → 404', async () => {
    await request(app).get('/api/plugins/runtime/nope.js').expect(404);
  });

  it('GET /api/plugins/<name>/frontend.js → 404 in phase 1', async () => {
    const res = await request(app).get('/api/plugins/@acme%2Fglossary/frontend.js').expect(404);
    expect(res.body.error.code).toBe('PLUGIN_FRONTEND_NOT_FOUND');
  });

  it('GET /api/_meta/plugins reports the synthetic builtin record + loader records', async () => {
    const withRecords = makeApp([
      { package: 'pkg-x', status: 'skipped', code: 'PLUGIN_HOST_API_MISMATCH' },
    ]);
    const res = await request(withRecords).get('/api/_meta/plugins').expect(200);
    expect(res.body.hostApiVersion).toBe(HOST_API_VERSION);
    const builtin = res.body.packages.find((p: { package: string }) => p.package === '@c4s/builtin');
    expect(builtin.status).toBe('loaded');
    /*
     * 0.2.80: the built-in record is down to `diagram` alone.
     *
     * Every other type is contributed by an envelope, each of which is its own
     * record: `endpoint`/`dto` since 0.2.2, `database-table` and `spreadsheet`
     * since 0.2.11, `ui-view`/`design-system` since 0.2.18, and `ac` since
     * 0.2.80. Asserting the exact set rather than one member is what makes a
     * type silently slipping back into the core bootstrap fail here.
     */
    expect([...builtin.contributedTypes].sort()).toEqual(['diagram']);

    expect(res.body.packages.some((p: { package: string }) => p.package === 'pkg-x')).toBe(true);
  });

  it('[ac:ac-pakiet-z-niezgodnym-majorem-hostapivers] a package with an incompatible hostApiVersion major is skipped with PLUGIN_HOST_API_MISMATCH; the host and the other plugins load; the state shows in /api/_meta/plugins', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pluginRegistry = new PluginRegistryImpl();
      registerAllPlugins(pluginRegistry);
      const modules: Record<string, PluginManifest> = {
        'pkg-old-major': glossaryManifest('@acme/old', '^1.0.0', 'old-glossary'),
        'pkg-good': glossaryManifest('@acme/good', `^${HOST_API_VERSION}`, 'good-glossary'),
      };
      const { records } = await loadWorkspacePlugins(pluginRegistry, Object.keys(modules), async (spec) => ({
        manifest: modules[spec],
      }));

      expect(records[0]).toMatchObject({ package: 'pkg-old-major', code: 'PLUGIN_HOST_API_MISMATCH' });
      expect(['skipped', 'incompatible']).toContain(records[0]!.status);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/PLUGIN_HOST_API_MISMATCH pkg-old-major/);
      // The other plugin and the host's own types load normally.
      expect(records[1]).toMatchObject({ package: 'pkg-good', status: 'loaded' });
      expect(pluginRegistry.getAvailable('good-glossary')).not.toBeNull();
      expect(pluginRegistry.getAvailable('old-glossary')).toBeNull();
      expect(pluginRegistry.getAvailable('diagram')).not.toBeNull();

      const app = express();
      app.use('/api', pluginsRouter({ pluginRegistry, pluginRecords: records }));
      const res = await request(app).get('/api/_meta/plugins').expect(200);
      const byPkg = new Map((res.body.packages as Array<{ package: string; status: string; code?: string }>).map((p) => [p.package, p]));
      expect(byPkg.get('pkg-old-major')).toMatchObject({ code: 'PLUGIN_HOST_API_MISMATCH' });
      expect(byPkg.get('pkg-good')).toMatchObject({ status: 'loaded' });
      expect(byPkg.get('@c4s/builtin')).toMatchObject({ status: 'loaded' });
    } finally {
      warn.mockRestore();
    }
  });
});

function glossaryManifest(name: string, hostApiVersion: string, type: string): PluginManifest {
  return {
    name,
    version: '1.0.0',
    hostApiVersion,
    contributes: {
      entities: [
        {
          type,
          data: FIXTURE_DATA,
          slugPattern: FIXTURE_SLUG_PATTERN,
          payloadVersion: 1,
          label: type,
          labelPlural: `${type}s`,
          displayOrder: 100,
          pathPrefix: `/${type}s`,
          systemPrompt: { roleNoun: type },
        },
      ],
    },
  };
}
