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
import { registerCoreReactions } from '../workspace/core-reactions.js';
import type { Root } from '../../shared/types.js';

registerCoreReactions();

/**
 * 2.1.23 — the domain is every root WITH A FACADE (kind `sidebar` ≠ `hidden`):
 * `pages` roots and `skills`, every raw file under `dir`, not only `.html`.
 *
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
  server.use('/api/static/:rootId', staticRouter((rootId) => byId.get(rootId), () => [...byId.keys()]));
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

  it('a rootId outside the roots with a facade answers ROOT_NOT_FOUND with the facade roots in hint', async () => {
    const { server } = await app();
    const res = await request(server).get('/api/static/briefs/x.html').expect(404);
    expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
    expect(res.body.error.hint).toContain('pages');
    expect(res.body.error.hint).toContain('skills');
    expect(res.body.error.hint).not.toContain('briefs');
  });

  it('a file missing from the dir of the root named by :rootId is 404', async () => {
    const { server } = await app();
    await request(server).get('/api/static/pages/missing.html').expect(404);
  });

  it('the `skills` root serves any raw package file — an image, not only .html — with a mime-derived Content-Type', async () => {
    const { cwd, server } = await app();
    const dir = path.join(cwd, '.claude4spec/skills', 'writer', 'assets');
    fs.mkdirSync(dir, { recursive: true });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    fs.writeFileSync(path.join(dir, 'diagram.png'), png);
    const res = await request(server).get('/api/static/skills/writer/assets/diagram.png').expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

/**
 * 2.1.27 — M30 L4 transport and refusals (`fkqoflce`): the three refusals carry a
 * bare `{ error }` body with no `code`, and EVERY file response sets both
 * `X-Content-Type-Options: nosniff` (no longer optional) and the CSP `sandbox`
 * header — the second isolation layer beside the iframe's `sandbox` attribute.
 */
describe('GET /api/static/:rootId/* — refusals and isolation headers (2.1.27)', () => {
  it('[entity:get-api-static] [section:fkqoflce] an empty path is 400 with a bare { error } body, no code', async () => {
    const { server } = await app();
    for (const url of ['/api/static/pages/', '/api/static/pages']) {
      const res = await request(server).get(url).expect(400);
      expect(typeof res.body.error).toBe('string');
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.code).toBeUndefined();
    }
  });

  it('[entity:get-api-static] [section:fkqoflce] a path escaping the root dir is 403 with a bare { error } body, no code', async () => {
    const { cwd, server } = await app();
    fs.writeFileSync(path.join(cwd, 'pages', 'secret.html'), '<p>s</p>');
    const res = await request(server).get('/api/static/adr/..%2F..%2Fpages%2Fsecret.html').expect(403);
    expect(typeof res.body.error).toBe('string');
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('[entity:get-api-static] [section:fkqoflce] a missing file is 404 with a bare { error } body, no code', async () => {
    const { server } = await app();
    const res = await request(server).get('/api/static/pages/missing.html').expect(404);
    expect(typeof res.body.error).toBe('string');
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  it('[entity:get-api-static] [section:fkqoflce] every file response sets nosniff and CSP sandbox allow-scripts allow-forms allow-modals', async () => {
    const { cwd, server } = await app();
    fs.writeFileSync(path.join(cwd, 'pages', 'mock.html'), '<p>mock</p>');
    fs.writeFileSync(path.join(cwd, 'pages', 'style.css'), 'p{}');
    for (const [url, type] of [
      ['/api/static/pages/mock.html', 'text/html'],
      ['/api/static/pages/style.css', 'text/css'],
    ] as const) {
      const res = await request(server).get(url).expect(200);
      expect(res.headers['content-type']).toContain(type);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe('sandbox allow-scripts allow-forms allow-modals');
      expect(res.headers['content-security-policy']).not.toContain('allow-same-origin');
    }
  });
});
