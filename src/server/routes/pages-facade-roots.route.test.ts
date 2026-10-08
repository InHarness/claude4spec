import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { FileWatchRuntime } from '../fs/watcher.js';
import { RootRegistry } from '../roots/registry.js';
import { KIND_DECLARATIONS, type RootKind, type SidebarDeclaration } from '../../shared/root-kinds.js';
import type { Root } from '../../shared/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { registerCoreReactions } from '../workspace/core-reactions.js';
import { mountRegistryRoots, type MountedRegistry } from '../workspace/root-registry-runtime.js';
import { pagesRouter, type PageRootRuntime } from './pages.js';

/**
 * 2.1.9 — the page routes `/api/pages/:rootId/*` address the roots WITH A
 * FACADE, and only them (M02 `l4rootseg`): a root of a kind whose `sidebar` is
 * not `hidden`. A registry root without one (`plans`, `briefs`, `patches`, …)
 * or an id outside the registry is `404 ROOT_NOT_FOUND`, for reads and writes
 * alike, and the refusal lists only roots with a facade.
 *
 * The rig is the real L13 build hook (`mountRegistryRoots`) and the router
 * resolving through its `rootRuntimes` exactly as `project-context.ts` does — so
 * what decides addressability here is the registry loop, not a hand-made map.
 */

registerCoreReactions();

const USER_ROOTS: Root[] = [
  { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
  { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
];

const tmpDirs: string[] = [];
const runtimes: FileWatchRuntime[] = [];

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

interface Rig {
  cwd: string;
  app: express.Express;
  mounted: MountedRegistry;
  registry: RootRegistry;
  abs: (rootId: string, rel: string) => string;
}

async function rig(): Promise<Rig> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-facade-routes-'));
  tmpDirs.push(cwd);
  const runtime = new FileWatchRuntime({ fsEvents: false });
  runtimes.push(runtime);
  const w = runtime.scoped('context:facade-routes#1');
  const registry = new RootRegistry(USER_ROOTS);
  const mounted = await mountRegistryRoots({ cwd, registry, userRoots: USER_ROOTS, w });
  // The same resolution `project-context.ts` wires: the facade runtimes, by id.
  const rootById = new Map(mounted.rootRuntimes.map((rt) => [rt.root.id, rt]));
  const resolveRoot = (rootId: string): PageRootRuntime | undefined => {
    const rt = rootById.get(rootId);
    return rt ? { root: rt.root, pages: rt.pages, writer: rt.writer, versions: null } : undefined;
  };
  const app = express();
  app.use(express.json());
  app.use('/api/pages/:rootId', pagesRouter(resolveRoot, null, {} as DiscoveryCore, () => [...rootById.keys()]));
  const abs = (rootId: string, rel: string): string => path.join(cwd, registry.get(rootId)!.dir, rel);
  return { cwd, app, mounted, registry, abs };
}

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function expectRootNotFound(res: request.Response, rootId: string): void {
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
  expect(res.body.error.message).toContain(`'${rootId}'`);
  // The navigation lists the roots WITH A FACADE — never a root without one.
  expect(res.body.error.hint).toBe('roots in this project: pages, adr');
}

async function withSidebar<T>(kind: RootKind, sidebar: SidebarDeclaration, fn: () => Promise<T>): Promise<T> {
  const decl = KIND_DECLARATIONS[kind];
  const previous = decl.sidebar;
  decl.sidebar = sidebar;
  try {
    return await fn();
  } finally {
    decl.sidebar = previous;
  }
}

describe('2.1.9 — /api/pages/:rootId addresses only roots with a facade (M02 l4rootseg, m02multidir)', () => {
  beforeAll(() => {
    // The fixture premise: today every system kind is `hidden`, the `pages` kind is not.
    expect(KIND_DECLARATIONS.pages.sidebar).toBe('accordion');
    for (const kind of ['plans', 'briefs', 'patches', 'entities', 'releases'] as const) {
      expect(KIND_DECLARATIONS[kind].sidebar).toBe('hidden');
    }
  });

  it('[ac:ac-get-api-pages-plans-zwraca-404-root-n] GET /api/pages/plans answers 404 ROOT_NOT_FOUND — `plans` is a registry root with a markdown store, but no facade', async () => {
    const { app, mounted, registry, abs } = await rig();
    // `plans` IS in the registry and has a store — the refusal is about the facade, not existence.
    expect(registry.get('plans')?.kind).toBe('plans');
    expect(mounted.storeByRootId.has('plans')).toBe(true);
    put(abs('plans', 'p.md'), '---\ntype: plan\n---\n# P\n');
    const res = await request(app).get('/api/pages/plans');
    expectRootNotFound(res, 'plans');
    expect(res.body).not.toHaveProperty('tree');
  });

  it('[entity:get-api-pages-rootid] GET /api/pages/:rootId → 200 { tree } for a root with a facade; 404 ROOT_NOT_FOUND for a root without one or outside the registry', async () => {
    const { app, abs } = await rig();
    put(abs('adr', 'a.md'), '---\ntitle: A\n---\n# A\n');
    put(abs('adr', 'view.html'), '<p>raw</p>');
    const ok = await request(app).get('/api/pages/adr');
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.tree)).toBe(true);
    expect(ok.body.tree).toEqual(
      expect.arrayContaining([
        { type: 'file', name: 'a.md', path: 'a.md', fileType: 'markdown' },
        { type: 'file', name: 'view.html', path: 'view.html', fileType: 'html' },
      ]),
    );
    expect(ok.body).not.toHaveProperty('data');
    for (const rootId of ['briefs', 'patches', 'entities', 'releases', 'nope']) {
      expectRootNotFound(await request(app).get(`/api/pages/${rootId}`), rootId);
    }
  });

  it('[entity:get-api-pages] GET /api/pages/:rootId/* → 200 page-detail (rootId, path, content as-is, frontmatter, hash) on a root with a facade; 404 ROOT_NOT_FOUND on a root without one', async () => {
    const { app, abs } = await rig();
    const text = '---\ntitle: Auth\norder: 1\n---\n\n# Auth\n\n<inline_mention type="dto" slug="x"/>\n';
    put(abs('pages', 'modules/auth.md'), text);
    const ok = await request(app).get('/api/pages/pages/modules/auth.md');
    expect(ok.status).toBe(200);
    expect(ok.body.path).toBe('modules/auth.md');
    expect(ok.body.rootId).toBe('pages');
    expect(ok.body.content).toBe(text);
    expect(ok.body.frontmatter).toEqual({ title: 'Auth', order: 1 });
    expect(ok.body.hash).toBe(sha(text));
    expect((await request(app).get('/api/pages/pages/missing.md')).status).toBe(404);

    put(abs('briefs', 'b.md'), '---\ntype: brief\n---\n# B\n');
    expectRootNotFound(await request(app).get('/api/pages/briefs/b.md'), 'briefs');
  });

  it('[entity:post-api-pages] POST /api/pages/:rootId → 201 { rootId, path, hash } with the default template on a root with a facade; 404 ROOT_NOT_FOUND on a root without one, nothing written', async () => {
    const { app, abs } = await rig();
    const ok = await request(app).post('/api/pages/adr').send({ path: 'new/n.md', title: 'New' });
    expect(ok.status).toBe(201);
    expect(ok.body.rootId).toBe('adr');
    expect(ok.body.path).toBe('new/n.md');
    expect(ok.body.hash).toMatch(/^[0-9a-f]{64}$/);
    const written = fs.readFileSync(abs('adr', 'new/n.md'), 'utf8');
    expect(written).toContain('title: New');
    expect(ok.body.hash).toBe(sha(written));

    const refused = await request(app).post('/api/pages/patches').send({ path: 'x.md', content: '# X\n' });
    expectRootNotFound(refused, 'patches');
    expect(fs.existsSync(abs('patches', 'x.md'))).toBe(false);
  });

  it('[entity:put-api-pages] PUT /api/pages/:rootId/* → 200 { hash, version, changedAnchors } with a matching expectedHash, 409 PAGE_CONFLICT with currentHash on a stale one; 404 ROOT_NOT_FOUND on a root without a facade, file untouched', async () => {
    const { app, abs } = await rig();
    const before = '# A\n\none\n';
    put(abs('pages', 'a.md'), before);
    const ok = await request(app).put('/api/pages/pages/a.md').send({ body: '# A\n\ntwo\n', expectedHash: sha(before) });
    expect(ok.status).toBe(200);
    expect(ok.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.body.hash).toBe(sha(fs.readFileSync(abs('pages', 'a.md'), 'utf8')));
    expect(typeof ok.body.version).toBe('number');
    expect(Array.isArray(ok.body.changedAnchors)).toBe(true);
    expect(ok.body).not.toHaveProperty('replacements');

    const stale = await request(app).put('/api/pages/pages/a.md').send({ body: 'three', expectedHash: sha(before) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PAGE_CONFLICT');
    expect(stale.body.currentHash).toBe(ok.body.hash);

    const plan = '---\ntype: plan\n---\n# P\n';
    put(abs('plans', 'p.md'), plan);
    const refused = await request(app).put('/api/pages/plans/p.md').send({ body: 'hijack', expectedHash: sha(plan) });
    expectRootNotFound(refused, 'plans');
    expect(fs.readFileSync(abs('plans', 'p.md'), 'utf8')).toBe(plan);
  });

  it('[entity:delete-api-pages] DELETE /api/pages/:rootId/* → 200 { ok, deleted: true } and the file is gone on a root with a facade; 404 ROOT_NOT_FOUND on a root without one, file kept', async () => {
    const { app, abs } = await rig();
    put(abs('adr', 'gone.md'), '# Gone\n');
    const ok = await request(app).delete('/api/pages/adr/gone.md');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, deleted: true });
    expect(fs.existsSync(abs('adr', 'gone.md'))).toBe(false);

    put(abs('briefs', 'keep.md'), '---\ntype: brief\n---\n# Keep\n');
    expectRootNotFound(await request(app).delete('/api/pages/briefs/keep.md'), 'briefs');
    expect(fs.existsSync(abs('briefs', 'keep.md'))).toBe(true);
  });

  it('[entity:get-api-pages-rootid-search] GET /api/pages/:rootId/search → 200 { hits } scoped to that root; 404 ROOT_NOT_FOUND on a root without a facade even when its files match', async () => {
    const { app, abs } = await rig();
    put(abs('pages', 'one.md'), '# One\n\nthe needle is here\n');
    put(abs('adr', 'other.md'), '# Other\n\nanother needle\n');
    put(abs('plans', 'p.md'), '---\ntype: plan\n---\n# P\n\nneedle in a plan\n');
    const ok = await request(app).get('/api/pages/pages/search').query({ q: 'needle' });
    expect(ok.status).toBe(200);
    expect(ok.body).not.toHaveProperty('data');
    expect(ok.body.hits.map((h: { path: string }) => h.path)).toEqual(['one.md']);
    expect(ok.body.hits[0]).toEqual(
      expect.objectContaining({ path: 'one.md', line: expect.any(Number), snippet: expect.stringContaining('needle') }),
    );
    expectRootNotFound(await request(app).get('/api/pages/plans/search').query({ q: 'needle' }), 'plans');
  });

  it('[entity:post-api-pages-rootid-move] POST /api/pages/:rootId/move → 200 { rootId, path: new, hash unchanged, version } within a root with a facade; 404 ROOT_NOT_FOUND on a root without one', async () => {
    const { app, abs } = await rig();
    const text = '# Move me\n';
    put(abs('pages', 'from.md'), text);
    const ok = await request(app)
      .post('/api/pages/pages/move')
      .send({ from: 'from.md', to: 'sub/to.md', expectedHash: sha(text) });
    expect(ok.status).toBe(200);
    expect(ok.body.rootId).toBe('pages');
    expect(ok.body.path).toBe('sub/to.md');
    expect(ok.body.hash).toBe(sha(text));
    expect(typeof ok.body.version).toBe('number');
    expect(fs.existsSync(abs('pages', 'from.md'))).toBe(false);
    expect(fs.readFileSync(abs('pages', 'sub/to.md'), 'utf8')).toBe(text);

    const plan = '---\ntype: plan\n---\n# P\n';
    put(abs('plans', 'p.md'), plan);
    const refused = await request(app)
      .post('/api/pages/plans/move')
      .send({ from: 'p.md', to: 'q.md', expectedHash: sha(plan) });
    expectRootNotFound(refused, 'plans');
    expect(fs.existsSync(abs('plans', 'p.md'))).toBe(true);
  });

  it('a root of a non-`pages` kind whose `sidebar` is not `hidden` gets a facade, and the same routes then address it', async () => {
    await withSidebar('plans', 'accordion', async () => {
      const { app, abs, mounted } = await rig();
      expect(mounted.rootRuntimes.map((rt) => rt.root.id)).toEqual(['pages', 'adr', 'plans']);
      put(abs('plans', 'p.md'), '---\ntype: plan\n---\n# P\n');
      const tree = await request(app).get('/api/pages/plans');
      expect(tree.status).toBe(200);
      expect(tree.body.tree).toEqual([{ type: 'file', name: 'p.md', path: 'p.md', fileType: 'markdown' }]);
      const read = await request(app).get('/api/pages/plans/p.md');
      expect(read.status).toBe(200);
      expect(read.body.frontmatter).toEqual({ type: 'plan' });
      // `briefs` stays hidden → still no facade.
      const refused = await request(app).get('/api/pages/briefs');
      expect(refused.status).toBe(404);
      expect(refused.body.error.hint).toBe('roots in this project: pages, adr, plans');
    });
  });
});
