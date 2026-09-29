import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { mcpConfigRouter } from './mcp-config.js';
import type { McpConfigResponse } from '../../shared/mcp-config.js';

describe('GET /_meta/mcp-config', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-mcp-config-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function setup(port: number) {
    const registry = new WorkspaceRegistry(dir);
    const workspace = registry.selectOrCreate({ name: 'default', port });
    const app = express();
    app.use('/_meta/mcp-config', mcpConfigRouter({ registry, workspace, projectId: 'p1' }));
    return { registry, workspace, app };
  }

  it('answers three server-rendered variants with the effective publicUrl and project id injected', async () => {
    const { app } = setup(4555);
    const res = await request(app).get('/_meta/mcp-config').expect(200);
    const body = res.body as McpConfigResponse;
    expect(body.variants.map((v) => v.id)).toEqual(['http-project', 'http-workspace', 'stdio']);
    for (const v of body.variants) {
      expect(typeof v.label).toBe('string');
      expect(v.snippet).toContain('http://localhost:4555/api/');
      expect(v.snippet).toContain('p1');
    }
  });

  it('renders per request — a changed workspace port or publicUrl shows on the next read', async () => {
    const { app } = setup(4555);
    await request(app).get('/_meta/mcp-config').expect(200);
    const file = path.join(dir, 'workspaces.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { workspaces: Array<{ defaultPort: number }> };
    data.workspaces[0]!.defaultPort = 4777;
    fs.writeFileSync(file, JSON.stringify(data));
    const res = await request(app).get('/_meta/mcp-config').expect(200);
    expect((res.body as McpConfigResponse).variants[0]!.snippet).toContain('http://localhost:4777/api/');

    const { registry } = setup(4777);
    registry.setNetwork('default', { publicUrl: 'https://c4s.firma.dev' });
    const again = await request(app).get('/_meta/mcp-config').expect(200);
    expect((again.body as McpConfigResponse).variants[0]!.snippet).toContain(
      'https://c4s.firma.dev/api/projects/p1/mcp',
    );
  });

  it('never takes the address from request headers', async () => {
    const { app } = setup(4555);
    const res = await request(app)
      .get('/_meta/mcp-config')
      .set('Host', 'evil.example')
      .set('X-Forwarded-Host', 'evil.example')
      .expect(200);
    for (const v of (res.body as McpConfigResponse).variants) expect(v.snippet).not.toContain('evil.example');
  });

  it('writes nothing to disk', async () => {
    const { app } = setup(4555);
    const before = fs.readdirSync(dir).sort();
    await request(app).get('/_meta/mcp-config').expect(200);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });
});
