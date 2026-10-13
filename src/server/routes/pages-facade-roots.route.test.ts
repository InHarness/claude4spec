import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import matter from 'gray-matter';
import { FileWatchRuntime } from '../fs/watcher.js';
import { RootRegistry } from '../roots/registry.js';
import { KIND_DECLARATIONS, type RootKind, type SidebarDeclaration } from '../../shared/root-kinds.js';
import type { Root } from '../../shared/types.js';
import type { DiscoveryCore } from '../discovery/types.js';
import { registerCoreReactions, type CoreReactionContext } from '../workspace/core-reactions.js';
import { ReactionBinder } from '../fs/reactions.js';
import { WsGateway } from '../ws/gateway.js';
import { ProjectWsEmitter } from '../ws/project-emitter.js';
import type { WsEvent } from '../../shared/types.js';
import { mountRegistryRoots, type MountedRegistry } from '../workspace/root-registry-runtime.js';
import { pagesRouter, type PageRootRuntime } from './pages.js';
import { SkillRegistry, SkillResolver } from '../services/skill-registry.js';
import { pageWritePayload } from '../../client/hooks/usePage.js';
import { registerProjectRootedSkills } from '../services/project-rooted-skills.js';

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
  runtime: FileWatchRuntime;
  w: ReturnType<FileWatchRuntime['scoped']>;
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
  return { cwd, app, mounted, registry, abs, runtime, w };
}

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function expectRootNotFound(res: request.Response, rootId: string): void {
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('ROOT_NOT_FOUND');
  expect(res.body.error.message).toContain(`'${rootId}'`);
  // The navigation lists the roots WITH A FACADE — never a root without one
  // (2.1.9: `skills`, M52, is one — a system kind whose `sidebar` is a reducer).
  expect(res.body.error.hint).toBe('roots in this project: pages, adr, skills');
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

  it('[entity:put-api-pages] 2.1.14 — the route renders update_page\'s literal mode: `body` + optional `frontmatter` replacing the old one wholesale, create-or-replace on a known root, the old `content` field refused', async () => {
    const { app, abs } = await rig();

    // Create-or-replace: no page under (rootId, relPath) is not an error — the route creates it.
    expect(fs.existsSync(abs('adr', 'new/fresh.md'))).toBe(false);
    const created = await request(app)
      .put('/api/pages/adr/new/fresh.md')
      .send({ body: '# Fresh\n\nfirst\n', frontmatter: { title: 'Fresh', order: 3 }, expectedHash: 'a'.repeat(64) });
    expect(created.status).toBe(200);
    const createdOnDisk = fs.readFileSync(abs('adr', 'new/fresh.md'), 'utf8');
    expect(matter(createdOnDisk).data).toEqual({ title: 'Fresh', order: 3 });
    expect(createdOnDisk).toContain('first');
    expect(created.body.hash).toBe(sha(createdOnDisk));

    // `frontmatter` replaces the page's frontmatter WHOLESALE — a key it omits is gone.
    const replaced = await request(app)
      .put('/api/pages/adr/new/fresh.md')
      .send({ body: '# Fresh\n\nsecond\n', frontmatter: { title: 'Renamed' }, expectedHash: created.body.hash });
    expect(replaced.status).toBe(200);
    const replacedOnDisk = fs.readFileSync(abs('adr', 'new/fresh.md'), 'utf8');
    expect(matter(replacedOnDisk).data).toEqual({ title: 'Renamed' });
    expect(replacedOnDisk).toContain('second');
    expect(replacedOnDisk).not.toContain('first');
    expect(replaced.body.hash).toBe(sha(replacedOnDisk));

    // No `frontmatter` → a page without one.
    const bare = await request(app)
      .put('/api/pages/adr/new/fresh.md')
      .send({ body: '# Fresh\n\nthird\n', expectedHash: replaced.body.hash });
    expect(bare.status).toBe(200);
    expect(matter(fs.readFileSync(abs('adr', 'new/fresh.md'), 'utf8')).data).toEqual({});

    // The removed `content` name describes nothing: 400 INVALID_ARGUMENT, nothing created.
    const legacy = await request(app)
      .put('/api/pages/adr/legacy.md')
      .send({ content: '# Legacy\n', expectedHash: 'a'.repeat(64) });
    expect(legacy.status).toBe(400);
    expect(legacy.body.error.code).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(abs('adr', 'legacy.md'))).toBe(false);
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
      expect(mounted.rootRuntimes.map((rt) => rt.root.id)).toEqual(['pages', 'adr', 'plans', 'skills']);
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
      expect(refused.body.error.hint).toBe('roots in this project: pages, adr, plans, skills');
    });
  });
});

describe('2.1.9 — the `skills` root has a facade (M52 i5frb6it, M02 m02multidir)', () => {
  it('[ac:ac-korzen-rodzaju-z-sidebar-innym-niz-hi] the `skills` root (kind sidebar = a reducer, not `hidden`) has a facade: GET /api/pages/skills returns its tree', async () => {
    expect(typeof KIND_DECLARATIONS.skills.sidebar).toBe('object');
    const { app, abs, mounted } = await rig();
    expect(mounted.rootRuntimes.find((rt) => rt.root.id === 'skills')?.kind).toBe('skills');
    put(abs('skills', 'writer/SKILL.md'), '---\ntitle: Writer\n---\n# Writer\n');
    put(abs('skills', 'writer/workflows/brief.md'), '# Brief\n');
    const res = await request(app).get('/api/pages/skills');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tree)).toBe(true);
    const flat = JSON.stringify(res.body.tree);
    expect(flat).toContain('"path":"writer/SKILL.md"');
    expect(flat).toContain('"path":"writer/workflows/brief.md"');
    // … and a package file is read through the same facade.
    const read = await request(app).get('/api/pages/skills/writer/SKILL.md');
    expect(read.status).toBe(200);
    expect(read.body.rootId).toBe('skills');
    expect(read.body.frontmatter).toEqual({ title: 'Writer' });
  });

  it('[ac:ac-put-api-pages-skills-pakiet-skill-md] PUT /api/pages/skills/<package>/SKILL.md with no `description` in the frontmatter saves the file — validity gates only the registry, never the write', async () => {
    const { app, abs } = await rig();
    const before = '---\ntitle: Writer\ndescription: Writes things.\nversion: 1\nlanguage: en\n---\n# Writer\n';
    put(abs('skills', 'writer/SKILL.md'), before);
    const res = await request(app)
      .put('/api/pages/skills/writer/SKILL.md')
      .send({ frontmatter: { title: 'Writer', version: 1, language: 'en' }, body: '# Writer\n\nNo description yet.\n', expectedHash: sha(before) });
    expect(res.status).toBe(200);
    const onDisk = fs.readFileSync(abs('skills', 'writer/SKILL.md'), 'utf8');
    expect(res.body.hash).toBe(sha(onDisk));
    expect(onDisk).toContain('No description yet.');
    expect(onDisk).toContain('title: Writer');
    expect(onDisk).not.toContain('description:');
    // No anchors are injected into a package file (the kind selects no `m06-*`).
    expect(onDisk).not.toContain('<!-- anchor:');
  });

  it('[ac:m52-invalid-frontmatter-package-editable] a package whose `SKILL.md` header is invalid opens in the page editor: a header off the contract reads as usual, and one whose YAML does not parse reads with the literal block aside and saves it back byte for byte', async () => {
    const { app, abs } = await rig();
    // (1) Parses, but breaks the contract: no `description`, an unknown context type, a future version.
    const offContract = '---\ntitle: Writer\ncontextTypes: [nope]\nversion: 99\n---\n# Writer\n';
    put(abs('skills', 'writer/SKILL.md'), offContract);
    const a = await request(app).get('/api/pages/skills/writer/SKILL.md');
    expect(a.status).toBe(200);
    expect(a.body.frontmatter).toEqual({ title: 'Writer', contextTypes: ['nope'], version: 99 });
    expect(a.body.body).toBe('# Writer\n');
    expect(a.body.hash).toBe(sha(offContract));
    expect(a.body).not.toHaveProperty('frontmatterRaw');

    // (2) YAML that does not parse: still 200, the block travels literally, the body is what follows it.
    const block = '---\ntitle: "Reviewer\n---\n';
    const broken = `${block}# Reviewer\n\nOld text.\n`;
    put(abs('skills', 'reviewer/SKILL.md'), broken);
    const b = await request(app).get('/api/pages/skills/reviewer/SKILL.md');
    expect(b.status).toBe(200);
    expect(b.body.frontmatter).toEqual({});
    expect(b.body.frontmatterRaw).toBe(block);
    expect(b.body.body).toBe('# Reviewer\n\nOld text.\n');
    expect(b.body.content).toBe(broken);
    expect(b.body.hash).toBe(sha(broken));

    // The editor's save of such a page (`pageWritePayload`): the block glued in
    // front of the edited body, no frontmatter object, guarded by the read hash.
    const saved = await request(app)
      .put('/api/pages/skills/reviewer/SKILL.md')
      .send({ body: `${b.body.frontmatterRaw}# Reviewer\n\nNew text.\n`, expectedHash: b.body.hash });
    expect(saved.status).toBe(200);
    const onDisk = fs.readFileSync(abs('skills', 'reviewer/SKILL.md'), 'utf8');
    expect(onDisk).toBe(`${block}# Reviewer\n\nNew text.\n`);
    expect(saved.body.hash).toBe(sha(onDisk));
  });

  it('[ac:m52-invalid-frontmatter-package-editable] a package whose `SKILL.md` YAML does not parse reads the same on every read, also after the skill registry / frontmatter indexer have already run gray-matter over the same bytes (a warm gray-matter cache)', async () => {
    const { app, abs } = await rig();
    // Bytes unique to this test, so the cache state is the one this test sets up.
    const block = '---\ntitle: "Auditor\ncontextTypes: [chat]\n---\n';
    const broken = `${block}# Auditor\n\nWarm-cache text.\n`;
    put(abs('skills', 'auditor/SKILL.md'), broken);

    // What the running app does before the editor opens the page: the skill
    // registry and the frontmatter indexer parse the same `SKILL.md` with an
    // option-less `matter(raw)`. The first call throws — and leaves the
    // half-parsed file in gray-matter's cache; a second option-less call on the
    // same bytes then answers without throwing, the broken block inside `content`.
    expect(() => matter(broken)).toThrow();
    const cached = matter(broken);
    expect(cached.data).toEqual({});
    expect(cached.content).toBe(broken);

    // The page read is not fooled by that cache: twice in a row, each time the
    // block aside as `frontmatterRaw` and only what follows it in `body`.
    for (let i = 0; i < 2; i++) {
      const res = await request(app).get('/api/pages/skills/auditor/SKILL.md');
      expect(res.status).toBe(200);
      expect(res.body.frontmatter).toEqual({});
      expect(res.body.frontmatterRaw).toBe(block);
      expect(res.body.body).toBe('# Auditor\n\nWarm-cache text.\n');
      expect(res.body.body).not.toContain('title: "Auditor');
      expect(res.body.content).toBe(broken);
      expect(res.body.hash).toBe(sha(broken));
    }
  });

  it('[ac:m52-page-editor-saves-skill-without-description] the page editor\'s save of a `SKILL.md` without `description` goes through: read → edit the body → PUT { body, frontmatter, expectedHash } as the editor sends it, twice in a row on the ack\'s hash', async () => {
    const { app, abs } = await rig();
    const original = '---\ntitle: Writer\nversion: 1\n---\n# Writer\n';
    put(abs('skills', 'writer/SKILL.md'), original);
    // What the editor opens: the page-detail read.
    const read = await request(app).get('/api/pages/skills/writer/SKILL.md');
    expect(read.status).toBe(200);
    expect(read.body.frontmatter).toEqual({ title: 'Writer', version: 1 });
    // The autosave: the frontmatter as read (no description), the edited body, the read hash.
    const first = await request(app)
      .put('/api/pages/skills/writer/SKILL.md')
      .send({ body: '# Writer\n\nFirst edit.\n', frontmatter: read.body.frontmatter, expectedHash: read.body.hash });
    expect(first.status).toBe(200);
    // The next autosave is guarded by the previous ack's hash.
    const second = await request(app)
      .put('/api/pages/skills/writer/SKILL.md')
      .send({ body: '# Writer\n\nSecond edit.\n', frontmatter: read.body.frontmatter, expectedHash: first.body.hash });
    expect(second.status).toBe(200);
    const onDisk = fs.readFileSync(abs('skills', 'writer/SKILL.md'), 'utf8');
    expect(second.body.hash).toBe(sha(onDisk));
    expect(onDisk).toContain('Second edit.');
    expect(onDisk).toContain('title: Writer');
    expect(onDisk).not.toContain('description');
  });
});

describe('2.1.9 — a write through the `skills` root facade is visible to the very next registry read (M52 q6jr8zoj "scan on demand")', () => {
  /**
   * The registry coalesces a burst of reads into one disk scan (a 500 ms window
   * by default). That window must never hide a write: the rig below keeps the
   * DEFAULT window (no `rescanTtlMs` override) and warms it right before the
   * write, so only the source's change stamp can make the next read see it.
   */
  async function skillsRig() {
    const r = await rig();
    const registry = SkillRegistry.load([
      { dir: path.join(r.cwd, '.claude', 'skills'), source: 'user', registration: 'user-project' },
    ]);
    registerProjectRootedSkills(registry, r.registry, r.cwd);
    const resolver = new SkillResolver(registry, r.cwd);
    const nextThreadListing = () => resolver.resolveForContext('chat', { writingStyle: null }).listing;
    return { ...r, registry, nextThreadListing };
  }

  it('[ac:m52-new-package-listed-next-thread] a package created with POST /api/pages/skills is on the chat listing read immediately after the 201, inside the coalescing window', async () => {
    const { app, registry, nextThreadListing } = await skillsRig();
    // Warm the window: this read scans, the next ones within 500 ms would not.
    expect(nextThreadListing().map((e) => e.slug)).not.toContain('reviewer');
    expect(registry.has('reviewer')).toBe(false);

    const content =
      '---\ntitle: Reviewer\ndescription: Reviews a module page.\nversion: 1\nlanguage: en\nscope: contextual\n---\n# Reviewer\n';
    const res = await request(app).post('/api/pages/skills').send({ path: 'reviewer/SKILL.md', content });
    expect(res.status).toBe(201);

    // No wait: the very next read carries it.
    expect(nextThreadListing()).toContainEqual({
      slug: 'reviewer',
      description: 'Reviews a module page.',
      origin: 'project-rooted',
    });
    expect(registry.has('reviewer')).toBe(true);
  });

  it('[ac:ac-roota-user-claude-skills-projekt-g] a writing style written into the `skills` root through the facade is selectable with `source: project-rooted` on the very next read, and an edit of its header through PUT is too', async () => {
    const { app, registry } = await skillsRig();
    expect(registry.listSelectable().map((s) => s.slug)).not.toContain('house-style');

    const content =
      '---\ntitle: House style\ndescription: How we write.\nversion: 1\nlanguage: en\nscope: writing-style\n---\n# House style\n';
    const created = await request(app).post('/api/pages/skills').send({ path: 'house-style/SKILL.md', content });
    expect(created.status).toBe(201);
    const style = registry.listSelectable().find((s) => s.slug === 'house-style');
    expect(style?.source).toBe('project-rooted');
    expect(style?.description).toBe('How we write.');

    // An edit of the header (same package, no new directory) is seen at once too.
    const edited = await request(app)
      .put('/api/pages/skills/house-style/SKILL.md')
      .send({
        frontmatter: { title: 'House style', description: 'How we write, revised.', version: 1, language: 'en', scope: 'writing-style' },
        body: '# House style\n',
        expectedHash: created.body.hash,
      });
    expect(edited.status).toBe(200);
    expect(registry.listSelectable().find((s) => s.slug === 'house-style')?.description).toBe('How we write, revised.');
  });
});

/**
 * 2.1.14 system-run reopen — criteria unchanged in the window whose `verifies`
 * points at `put-api-pages`, given tests of their own over the real route.
 */
describe('2.1.14 — PUT /api/pages/:rootId/* criteria (M02 m02octconc, the literal write)', () => {
  /** The DTO `update-page-response`: the fields its definition names, nothing else. */
  const UPDATE_PAGE_RESPONSE_FIELDS = ['hash', 'version', 'changedAnchors', 'replacements'];
  function expectUpdatePageResponse(body: Record<string, unknown>): void {
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof body.version).toBe('number');
    expect(Array.isArray(body.changedAnchors)).toBe(true);
    for (const key of Object.keys(body)) expect(UPDATE_PAGE_RESPONSE_FIELDS).toContain(key);
    // The response never carries the page.
    expect(body).not.toHaveProperty('content');
    expect(body).not.toHaveProperty('body');
  }

  it('[ac:ac-trasy-patch-i-put-pod-sciezka-strony] PATCH and PUT on the page path call the same core function and answer the same response shape; only the way the new content is described differs', async () => {
    const { app, abs } = await rig();
    const v0 = '# A\n\none\n';
    put(abs('pages', 'a.md'), v0);

    // PUT describes the new content as a whole `body`…
    const viaPut = await request(app).put('/api/pages/pages/a.md').send({ body: '# A\n\ntwo\n', expectedHash: sha(v0) });
    expect(viaPut.status).toBe(200);
    expectUpdatePageResponse(viaPut.body);
    expect(viaPut.body).not.toHaveProperty('replacements');
    expect(viaPut.body.hash).toBe(sha(fs.readFileSync(abs('pages', 'a.md'), 'utf8')));

    // …PATCH as `textEdits` over the same file, guarded by the hash PUT returned.
    const viaPatch = await request(app)
      .patch('/api/pages/pages/a.md')
      .send({ textEdits: [{ find: 'two', replaceWith: 'three' }], expectedHash: viaPut.body.hash });
    expect(viaPatch.status).toBe(200);
    expectUpdatePageResponse(viaPatch.body);
    expect(viaPatch.body.replacements).toBe(1);
    const afterPatch = fs.readFileSync(abs('pages', 'a.md'), 'utf8');
    expect(afterPatch).toContain('three');
    expect(viaPatch.body.hash).toBe(sha(afterPatch));
    // The same required fields, the same types — one DTO for both renderings.
    const required = (b: Record<string, unknown>) => Object.keys(b).filter((k) => k !== 'replacements').sort();
    expect(required(viaPatch.body)).toEqual(required(viaPut.body));

    // Each route reads only its own content description: PUT does not take
    // `textEdits`, PATCH does not take `body` — both reach the core as
    // "neither mode" and the core refuses with the same INVALID_ARGUMENT.
    const putWithEdits = await request(app)
      .put('/api/pages/pages/a.md')
      .send({ textEdits: [{ find: 'three', replaceWith: 'four' }], expectedHash: viaPatch.body.hash });
    const patchWithBody = await request(app)
      .patch('/api/pages/pages/a.md')
      .send({ body: '# A\n\nfour\n', expectedHash: viaPatch.body.hash });
    for (const refused of [putWithEdits, patchWithBody]) {
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('INVALID_ARGUMENT');
      expect(refused.body.error.message).toBe('one of body or textEdits is required');
    }
    expect(fs.readFileSync(abs('pages', 'a.md'), 'utf8')).toBe(afterPatch);

    // Both handlers delegate to the ONE core function `updatePage`, with the same actor.
    const src = fs.readFileSync(path.join(import.meta.dirname, 'pages.ts'), 'utf8');
    const putAt = src.indexOf("router.put('/*'");
    const patchAt = src.indexOf("router.patch('/*'");
    const deleteAt = src.indexOf("router.delete('/*'");
    expect(putAt).toBeGreaterThan(-1);
    expect(patchAt).toBeGreaterThan(putAt);
    expect(deleteAt).toBeGreaterThan(patchAt);
    for (const handler of [src.slice(putAt, patchAt), src.slice(patchAt, deleteAt)]) {
      expect(handler).toContain('await updatePage(');
      expect(handler).toContain("'user',");
    }
  });

  it('[ac:ac-put-api-pages-path-przyjmuje-opcjona] PUT with an expectedHash that does not match the file refuses the write with 409 PAGE_CONFLICT carrying currentHash and currentContent', async () => {
    const { app, abs } = await rig();
    const onDisk = '---\ntitle: Live\n---\n# Live\n\nsomebody else wrote this\n';
    put(abs('pages', 'c.md'), onDisk);
    const stale = sha('# Live\n\nthe copy the caller read\n');

    const res = await request(app).put('/api/pages/pages/c.md').send({ body: '# Live\n\nmine\n', expectedHash: stale });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAGE_CONFLICT');
    expect(res.body.currentHash).toBe(sha(onDisk));
    expect(res.body.currentContent).toBe(onDisk);
    // Refused before the write: the file is byte-identical.
    expect(fs.readFileSync(abs('pages', 'c.md'), 'utf8')).toBe(onDisk);

    // The currentHash the refusal carried arms the retry.
    const retry = await request(app)
      .put('/api/pages/pages/c.md')
      .send({ body: '# Live\n\nmine\n', expectedHash: res.body.currentHash });
    expect(retry.status).toBe(200);
  });

  it('[ac:ac-put-api-pages-rootid-bez-pola-expecte] PUT without an `expectedHash` field is refused with INVALID_ARGUMENT — an unguarded write is not a backwards-compatible variant', async () => {
    const { app, abs } = await rig();
    const before = '# Guarded\n\nkept\n';
    put(abs('pages', 'g.md'), before);

    const existing = await request(app).put('/api/pages/pages/g.md').send({ body: '# Guarded\n\noverwritten\n' });
    expect(existing.status).toBe(400);
    expect(existing.body.error.code).toBe('INVALID_ARGUMENT');
    expect(existing.body.error.message).toBe('expectedHash is required');
    expect(fs.readFileSync(abs('pages', 'g.md'), 'utf8')).toBe(before);

    // An empty string is no guard either, and a missing page is not an exemption.
    const empty = await request(app).put('/api/pages/pages/g.md').send({ body: '# Guarded\n\nx\n', expectedHash: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('INVALID_ARGUMENT');
    const absent = await request(app).put('/api/pages/pages/new.md').send({ body: '# New\n' });
    expect(absent.status).toBe(400);
    expect(absent.body.error.code).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(abs('pages', 'new.md'))).toBe(false);
    expect(fs.readFileSync(abs('pages', 'g.md'), 'utf8')).toBe(before);
  });

  it('[ac:ac-zapis-z-tiptap-zachowuje-frontmatter-i-x] a save from the tiptap editor keeps the frontmatter and the XML tags', async () => {
    const { app, abs } = await rig();
    const tags = [
      '<inline_mention type="dto" slug="user"/>',
      '<single_element type="endpoint" slug="put-api-pages" caption="The write"/>',
      '<element_list type="dto" slugs="a,b"/>',
      '<tagged_list type="ac" tags="m02,core" filter="or"/>',
      '<section_ref anchor="abcd1234"/>',
      '<todo comment="later"/>',
    ];
    const original =
      '---\ntitle: Pages\norder: 2\ntags:\n  - m02\n  - core\n---\n' +
      `# Pages\n\nSee ${tags[0]} here.\n\n${tags[1]}\n\n${tags[2]}\n\n${tags[3]}\n\nRead ${tags[4]} and fix ${tags[5]} this.\n\nDRAFT\n`;
    put(abs('pages', 'm.md'), original);

    // What the editor holds: the page-detail read (frontmatter apart, body below it)…
    const detail = await request(app).get('/api/pages/pages/m.md');
    expect(detail.status).toBe(200);
    const editorBody = matter(detail.body.content as string).content;
    // …and what its save sends (`api.write`: { body, frontmatter, expectedHash }),
    // the body edited by the user, the tags in it untouched.
    const saved = await request(app)
      .put('/api/pages/pages/m.md')
      .send({ body: editorBody.replace('DRAFT', 'FINAL'), frontmatter: detail.body.frontmatter, expectedHash: detail.body.hash });
    expect(saved.status).toBe(200);

    const onDisk = fs.readFileSync(abs('pages', 'm.md'), 'utf8');
    expect(onDisk).toContain('FINAL');
    expect(onDisk).not.toContain('DRAFT');
    // The frontmatter survives the save — every key and value.
    expect(matter(onDisk).data).toEqual({ title: 'Pages', order: 2, tags: ['m02', 'core'] });
    // Every XML tag is on disk byte for byte.
    for (const tag of tags) expect(onDisk).toContain(tag);
    expect(saved.body.hash).toBe(sha(onDisk));

    // A second autosave on the ack's hash keeps them too.
    const again = await request(app)
      .put('/api/pages/pages/m.md')
      .send({ body: matter(onDisk).content, frontmatter: matter(onDisk).data, expectedHash: saved.body.hash });
    expect(again.status).toBe(200);
    const twice = fs.readFileSync(abs('pages', 'm.md'), 'utf8');
    expect(matter(twice).data).toEqual({ title: 'Pages', order: 2, tags: ['m02', 'core'] });
    for (const tag of tags) expect(twice).toContain(tag);
  });

  describe('file:changed over a live WS gateway', () => {
    let server: Server | null = null;
    let gateway: WsGateway | null = null;
    const sockets: WebSocket[] = [];

    afterEach(async () => {
      for (const s of sockets.splice(0)) s.close();
      await gateway?.close();
      gateway = null;
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      server = null;
    });

    /** A client in `project`'s room, recording every event after `hello`. */
    async function client(project: string): Promise<WsEvent[]> {
      const port = (server!.address() as { port: number }).port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?project=${project}`);
      sockets.push(ws);
      const seen: WsEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        ws.on('message', (data) => {
          const event = JSON.parse(String(data)) as WsEvent;
          if (event.kind === 'hello') resolve();
          else seen.push(event);
        });
        ws.on('error', reject);
      });
      return seen;
    }

    async function until(cond: () => boolean, ms = 2000): Promise<void> {
      const end = Date.now() + ms;
      while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    }

    it('[ac:ac-powiadomienie-file-changed-o-zapisie] the file:changed notice of the app\'s own write reaches the other clients in the project room, although the file event was suppressed', async () => {
      server = createServer();
      gateway = new WsGateway(server, () => true);
      await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));

      const { app, abs, mounted, runtime, w } = await rig();
      const source = mounted.sourceByRootId.get('pages')!;
      // The base reaction, bound the way `bindRegistryReactions` binds it, on
      // the emitter of project `p1` — its room on the live gateway.
      const ctx = { ws: new ProjectWsEmitter(gateway, 'p1') } as unknown as CoreReactionContext;
      new ReactionBinder(w, ctx).bindReaction('m02-file-changed', source, 'pages', { rootId: 'pages' });

      const first = await client('p1');
      const second = await client('p1');
      const elsewhere = await client('p2');
      const suppress = vi.spyOn(runtime, 'suppress');

      const before = '# W\n\none\n';
      put(abs('pages', 'w.md'), before);
      const res = await request(app).put('/api/pages/pages/w.md').send({ body: '# W\n\ntwo\n', expectedHash: sha(before) });
      expect(res.status).toBe(200);

      // The write swallowed its own file event…
      expect(suppress).toHaveBeenCalledWith(expect.any(String), source, 'w.md', 'primitive');

      // …and still every client in the room hears of it, once, as the server's own change.
      const fileChanged = (seen: WsEvent[]) => seen.filter((e) => e.kind === 'file:changed');
      await until(() => fileChanged(first).length > 0 && fileChanged(second).length > 0);
      await new Promise((r) => setTimeout(r, 50));
      const expected = { kind: 'file:changed', event: 'change', path: 'w.md', rootId: 'pages', origin: 'server' };
      expect(fileChanged(first)).toEqual([expected]);
      expect(fileChanged(second)).toEqual([expected]);
      // The room is the project's: another project's client hears nothing.
      expect(fileChanged(elsewhere)).toEqual([]);
    });
  });
});

/**
 * 2.1.17 — M02 `gnxw0ua1` / `xlx33i1v`: a page whose frontmatter YAML does not
 * parse reads, and the editor's save of it keeps the block byte for byte.
 */
describe('2.1.17 — a page whose frontmatter does not parse (M02 gnxw0ua1, xlx33i1v)', () => {
  it('[entity:page-detail] GET /api/pages/:rootId/* answers PageDetail: path, title, content, frontmatter required with their types; frontmatterRaw only when the YAML does not parse', async () => {
    const { app, abs } = await rig();
    // (1) A header that parses: title from the frontmatter, no frontmatterRaw.
    const good = '---\ntitle: M01 — Auth\norder: 1\nmodule: m01\n---\n\n# Heading\n\nContent...\n';
    put(abs('pages', 'modules/m01-auth.md'), good);
    const a = await request(app).get('/api/pages/pages/modules/m01-auth.md');
    expect(a.status).toBe(200);
    expect(typeof a.body.path).toBe('string');
    expect(a.body.path).toBe('modules/m01-auth.md');
    expect(typeof a.body.title).toBe('string');
    expect(a.body.title).toBe('M01 — Auth');
    expect(typeof a.body.content).toBe('string');
    expect(a.body.content).toBe(good);
    expect(a.body.frontmatter).toEqual({ title: 'M01 — Auth', order: 1, module: 'm01' });
    expect(a.body).not.toHaveProperty('frontmatterRaw');

    // (2) No header: frontmatter `{}`, title from the first H1, no frontmatterRaw.
    put(abs('pages', 'plain.md'), '# Plain page\n\nText.\n');
    const b = await request(app).get('/api/pages/pages/plain.md');
    expect(b.status).toBe(200);
    expect(b.body.frontmatter).toEqual({});
    expect(b.body.title).toBe('Plain page');
    expect(b.body).not.toHaveProperty('frontmatterRaw');

    // (3) No header, no H1: the label chain closes on `path`.
    put(abs('pages', 'notes/bare.md'), 'Just text.\n');
    const c = await request(app).get('/api/pages/pages/notes/bare.md');
    expect(c.body.title).toBe('notes/bare.md');

    // (4) The DTO's second example: YAML that does not parse — frontmatter `{}`,
    // the literal block (fences included) in `frontmatterRaw`, title from the H1.
    const block = '---\ndescription: [niezamknięta lista\n---\n';
    const broken = `${block}\n# Mój skill\n\nTreść...`;
    put(abs('pages', 'moj-skill/SKILL.md'), broken);
    const d = await request(app).get('/api/pages/pages/moj-skill/SKILL.md');
    expect(d.status).toBe(200);
    expect(d.body.path).toBe('moj-skill/SKILL.md');
    expect(d.body.frontmatter).toEqual({});
    expect(typeof d.body.frontmatterRaw).toBe('string');
    expect(d.body.frontmatterRaw).toBe(block);
    expect(d.body.title).toBe('Mój skill');
    expect(d.body.content).toBe(broken);
  });

  it('[ac:ac-odczyt-strony-z-nieparsowalnym-frontmatterem] reading a page whose frontmatter YAML does not parse answers 200 with `frontmatter` = {} and the literal block in `frontmatterRaw`, not a server error', async () => {
    const { app, abs } = await rig();
    const block = '---\ntitle: "Unclosed\norder: [1, 2\n---\n';
    const broken = `${block}# Broken header\n\nBody text.\n`;
    put(abs('pages', 'modules/broken.md'), broken);
    // Premise: this block really does not parse.
    expect(() => matter(broken, {})).toThrow();

    const res = await request(app).get('/api/pages/pages/modules/broken.md');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('error');
    expect(res.body.frontmatter).toEqual({});
    // The block byte for byte, delimiters included.
    expect(res.body.frontmatterRaw).toBe(block);
    // The rest of the record reads as usual: the whole file, its hash, the label from the H1.
    expect(res.body.content).toBe(broken);
    expect(res.body.hash).toBe(sha(broken));
    expect(res.body.title).toBe('Broken header');
    expect(res.body.body).toBe('# Broken header\n\nBody text.\n');
  });

  it('[ac:ac-zapis-z-edytora-zachowuje-nieparsowalny-frontmatter] the editor\'s save of a page whose frontmatter does not parse, header untouched, leaves the block in the file byte for byte (no empty header put in its place)', async () => {
    const { app, abs } = await rig();
    const block = '---\ntitle: "Unclosed\ntags: [a, b\n---\n';
    const original = `${block}# Draft page\n\nDRAFT\n`;
    put(abs('pages', 'draft.md'), original);

    // What the editor holds: the page-detail read.
    const read = await request(app).get('/api/pages/pages/draft.md');
    expect(read.status).toBe(200);
    expect(read.body.frontmatterRaw).toBe(block);

    // What the editor sends (`pageWritePayload`): the block glued in front of the
    // edited body, no frontmatter object — even though it holds `frontmatter: {}`.
    const payload = pageWritePayload({
      body: (read.body.body as string).replace('DRAFT', 'FINAL'),
      frontmatter: read.body.frontmatter,
      frontmatterRaw: read.body.frontmatterRaw,
    });
    expect(payload.frontmatter).toBeUndefined();
    const saved = await request(app)
      .put('/api/pages/pages/draft.md')
      .send({ ...payload, expectedHash: read.body.hash });
    expect(saved.status).toBe(200);

    const onDisk = fs.readFileSync(abs('pages', 'draft.md'), 'utf8');
    // The block opens the file exactly as before; the edit landed below it.
    expect(onDisk.startsWith(block)).toBe(true);
    expect(onDisk).toContain('FINAL');
    expect(onDisk).not.toContain('DRAFT');
    // No empty header substituted for the broken one.
    expect(onDisk.startsWith('---\n---')).toBe(false);
    expect(onDisk).not.toContain('{}\n---');
    expect(saved.body.hash).toBe(sha(onDisk));

    // A second save on the ack's hash still keeps the block.
    const reread = await request(app).get('/api/pages/pages/draft.md');
    expect(reread.body.frontmatterRaw).toBe(block);
    const again = await request(app)
      .put('/api/pages/pages/draft.md')
      .send({ ...pageWritePayload({ body: reread.body.body, frontmatter: reread.body.frontmatter, frontmatterRaw: reread.body.frontmatterRaw }), expectedHash: saved.body.hash });
    expect(again.status).toBe(200);
    expect(fs.readFileSync(abs('pages', 'draft.md'), 'utf8').startsWith(block)).toBe(true);
  });
});
