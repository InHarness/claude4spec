import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/serialization/registerAll.js';
import { pluginsRouter } from '../../../src/server/routes/plugins.js';
import { HOST_API_VERSION } from '../../../src/shared/plugin-host/manifest.js';

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
    expect(builtin.contributedTypes).toContain('endpoint');
    expect(res.body.packages.some((p: { package: string }) => p.package === 'pkg-x')).toBe(true);
  });
});
