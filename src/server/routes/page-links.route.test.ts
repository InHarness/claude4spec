import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageLinksRouter } from './page-links.js';
import { PagesLinkIndexerService } from '../services/pages-link-indexer.js';
import { PagesService } from '../services/pages.js';
import { FileWatchRuntime, type WatchScope } from '../fs/watcher.js';
import { RecordStore } from '../fs/record-store.js';
import { markdownAdapter, type MarkdownRecord } from '../fs/record-adapters.js';

/**
 * 2.1.8 (M14) — `GET /api/page-links/autocomplete` over every `pages` root, with
 * the editor's source root as the optional `root` query param: a path present in
 * several roots is suggested once, from the root `@path.md` would resolve to
 * (source root → `builtin` → `roots[]` order).
 */
describe('GET /api/page-links/autocomplete — source root precedence', () => {
  /** Map order a, b, pages — the builtin root last, so "builtin before the rest" is visible. */
  const ROOT_IDS = ['a', 'b', 'pages'] as const;
  const SCOPE: WatchScope = 'context:page-links-route-rig';
  let cwd: string;
  let runtime: FileWatchRuntime;
  let app: express.Express;

  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-page-links-route-'));
    runtime = new FileWatchRuntime({ fsEvents: false });
    const services = new Map<string, PagesService>();
    for (const id of ROOT_IDS) {
      const svc = new PagesService(cwd, id, id);
      await svc.ensureRoot();
      runtime.mountSource({ source: `pages:${id}`, dir: svc.root, scope: SCOPE });
      svc.records = new RecordStore<MarkdownRecord>({
        registrar: runtime.scoped(SCOPE),
        source: `pages:${id}`,
        dir: svc.root,
        adapter: markdownAdapter,
      });
      services.set(id, svc);
    }
    const write = (rootId: string, rel: string, body: string) =>
      fs.writeFileSync(path.join(services.get(rootId)!.root, rel), body, 'utf-8');
    for (const id of ROOT_IDS) write(id, 'x.md', `# X in ${id}\n`);
    write('b', 'only-b.md', '# Only b\n');
    const indexer = new PagesLinkIndexerService(services, { broadcast: () => {} } as never, undefined, {
      builtinRootId: 'pages',
      rootDirs: new Map(ROOT_IDS.map((id) => [id, id])),
    });
    await indexer.indexAll();
    app = express();
    app.use('/api/page-links', pageLinksRouter(indexer));
  });

  afterEach(async () => {
    await runtime.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('[ac:ac-resolve-i-autocomplete-path-md-sa-ogran] ?root= puts the source root first: a path in several roots is offered once, from the source root', async () => {
    const res = await request(app).get('/api/page-links/autocomplete').query({ q: 'x', root: 'b' });
    expect(res.status).toBe(200);
    const xs = res.body.suggestions.filter((s: { path: string }) => s.path === 'x.md');
    expect(xs).toEqual([expect.objectContaining({ path: 'x.md', rootId: 'b', title: 'X in b' })]);
  });

  it('[ac:ac-resolve-i-autocomplete-path-md-sa-ogran] without ?root= the builtin root wins over earlier roots, and suggestions span every pages root', async () => {
    const res = await request(app).get('/api/page-links/autocomplete').query({ limit: '50' });
    expect(res.status).toBe(200);
    const paths = res.body.suggestions.map((s: { path: string }) => s.path).sort();
    expect(paths).toEqual(['only-b.md', 'x.md']);
    expect(res.body.suggestions.find((s: { path: string }) => s.path === 'x.md')).toMatchObject({
      rootId: 'pages',
      title: 'X in pages',
    });
    expect(res.body.suggestions.find((s: { path: string }) => s.path === 'only-b.md')).toMatchObject({ rootId: 'b' });
  });
});
