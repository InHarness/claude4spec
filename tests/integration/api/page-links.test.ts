import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PagesService } from '../../../src/server/services/pages.js';
import { PagesLinkIndexerService } from '../../../src/server/services/pages-link-indexer.js';
import { pageLinksRouter } from '../../../src/server/routes/page-links.js';
import type { WsEmitter } from '../../../src/server/ws/project-emitter.js';

// createTestApp() does not wire the page-links router, so mount it standalone over a
// throwaway pages root — the same ingredients the shared helper already uses.
const ws: WsEmitter = { broadcast: () => {} };

describe('GET /api/page-links', () => {
  let cwd: string;
  let app: Express;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plink-api-'));
    const root = path.join(cwd, 'pages');
    await fs.mkdir(path.join(root, 'reference'), { recursive: true });
    await fs.writeFile(path.join(root, 'reference', 'x.md'), '# X\n');
    await fs.writeFile(
      path.join(root, 'index.md'),
      'Resolved @reference/x.md and unresolved @nope/missing.md\n',
    );
    const pages = new PagesService(cwd, 'pages', 'pages');
    const indexer = new PagesLinkIndexerService(new Map([['pages', pages]]), ws);
    await indexer.indexAll();
    app = express();
    app.use('/api/page-links', pageLinksRouter(indexer));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('keys links / reverseLinks / unresolved by composite `${rootId}:${relPath}`', async () => {
    const res = await request(app).get('/api/page-links');
    expect(res.status).toBe(200);

    const composite = /^[^:]+:/;
    for (const k of Object.keys(res.body.links)) expect(k).toMatch(composite);
    for (const k of Object.keys(res.body.reverseLinks)) expect(k).toMatch(composite);
    for (const k of Object.keys(res.body.unresolved)) expect(k).toMatch(composite);
    // reverseLinks values (source keys) are composite too.
    for (const sources of Object.values(res.body.reverseLinks as Record<string, string[]>)) {
      for (const s of sources) expect(s).toMatch(composite);
    }

    expect(res.body.links['pages:index.md']).toBeDefined();
    expect(res.body.reverseLinks['pages:reference/x.md']).toEqual(['pages:index.md']);
    expect(res.body.unresolved['pages:index.md']).toBeDefined();
    expect(res.body.counts.totalLinks).toBeGreaterThanOrEqual(1);
  });

  it('autocomplete returns bare root-relative `meta.path` (no rootId prefix)', async () => {
    const res = await request(app).get('/api/page-links/autocomplete').query({ q: 'x' });
    expect(res.status).toBe(200);
    const paths = (res.body.suggestions as Array<{ path: string }>).map((s) => s.path);
    expect(paths).toContain('reference/x.md');
    for (const p of paths) expect(p).not.toContain(':');
  });
});
