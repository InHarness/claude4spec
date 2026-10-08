import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { staticRouter } from './static.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { RootRegistry } from '../roots/registry.js';
import { mountRegistryRoots } from '../workspace/root-registry-runtime.js';
import type { Root } from '../../shared/types.js';

/**
 * 2.1.8 — M30 as a consumer of L13 (`m30l13rt`). The `.html` preview has no
 * kind of its own: the raw `**\/*.html` entry belongs to the `pages` kind's file
 * map, so `GET /api/static/:rootId/*` serves every root of kind `pages`, the
 * path resolved against THAT root's `dir`; a `rootId` outside the `pages` kind
 * (unknown, or a system root such as `plans`) → 404 ROOT_NOT_FOUND, no fallback.
 *
 * The resolver is built exactly as the context builds it: from the facades the
 * registry loop creates for the `pages` roots.
 */

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const ROOTS: Root[] = [
  { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
  { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
];

async function app(): Promise<{ cwd: string; server: express.Express }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-static-route-'));
  tmpDirs.push(cwd);
  const r = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(r);
  const registry = new RootRegistry(ROOTS);
  const mounted = await mountRegistryRoots({ cwd, registry, userRoots: ROOTS, w: r.scoped('context:static#1') });
  const byId = new Map(mounted.rootRuntimes.map((rt) => [rt.root.id, rt.staticHtml]));
  const server = express();
  server.use('/api/static/:rootId', staticRouter((rootId) => byId.get(rootId)));
  return { cwd, server };
}

describe('GET /api/static/:rootId/* — every root of kind pages (M30 m30l13rt)', () => {
  it('the same relPath in two pages roots is two files, each resolved against its own root dir', async () => {
    const { cwd, server } = await app();
    fs.writeFileSync(path.join(cwd, 'pages', 'report.html'), '<p>base</p>');
    fs.writeFileSync(path.join(cwd, 'docs/adr', 'report.html'), '<p>adr</p>');

    const base = await request(server).get('/api/static/pages/report.html').expect(200);
    const adr = await request(server).get('/api/static/adr/report.html').expect(200);
    expect(base.text).toBe('<p>base</p>');
    expect(adr.text).toBe('<p>adr</p>');
    expect(adr.headers['content-security-policy']).toContain('sandbox');
  });

  it('a rootId outside the pages kind — a system root or an unknown id — is 404 ROOT_NOT_FOUND, never a fallback', async () => {
    const { cwd, server } = await app();
    fs.writeFileSync(path.join(cwd, 'pages', 'x.html'), '<p>x</p>');
    fs.writeFileSync(path.join(cwd, '.claude4spec/plans', 'x.html'), '<p>plan</p>');

    for (const rootId of ['plans', 'briefs', 'nope']) {
      const res = await request(server).get(`/api/static/${rootId}/x.html`).expect(404);
      expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
    }
  });

  it('the path-traversal guard resolves against the resolved root dir', async () => {
    const { cwd, server } = await app();
    fs.writeFileSync(path.join(cwd, 'pages', 'secret.html'), '<p>s</p>');
    // `docs/adr/../../pages/secret.html` would leave the adr root.
    await request(server).get('/api/static/adr/..%2F..%2Fpages%2Fsecret.html').expect(403);
  });
});
