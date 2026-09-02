import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { PagesService } from '../services/pages.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { ChatService } from '../services/chat.js';
import { BriefService } from '../services/brief.js';
import { briefsRouter } from './briefs.js';
import { errorHandler } from './errors.js';
import { BRIEF_ROOT_MARKER } from '../../shared/types.js';
import type { ReleaseService } from '../services/release.js';
import type { WsEmitter } from '../ws/project-emitter.js';

const fakeWs = { broadcast: () => {} } as unknown as WsEmitter;

/**
 * `POST /api/briefs` — the one brief-specific creation endpoint left outside the
 * M36 artifact family. Its response is the contract `runAgent`'s create-mode
 * reads: a full `BriefResponse`, whose `threads[0]` is the editorial thread
 * minted alongside the file. There is no separate field carrying that id.
 */
describe('briefsRouter — POST /api/briefs', () => {
  let cwd: string;
  let db: Database.Database;
  let app: express.Express;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-briefs-route-test-'));
    db = new Database(':memory:');
    runMigrations(db);

    const briefsPages = new PagesService(cwd, 'briefs', BRIEF_ROOT_MARKER);
    await briefsPages.ensureRoot();
    const watchRuntime = new FileWatchRuntime({ fsEvents: false });
    const scoped = watchRuntime.scoped('context:test');
    watchRuntime.mountSource({ source: artifactSource('brief'), dir: briefsPages.root, scope: 'context:test' });
    const briefsSerializer = new FileSerializer(briefsPages);
    const pageVersions = new FileVersionService(db, briefsSerializer);
    const frontmatterIndexer = new PagesFrontmatterIndexer(
      new Map([[BRIEF_ROOT_MARKER, briefsPages]]),
      fakeWs,
    );
    const chatService = new ChatService(db);
    const briefService = new BriefService({
      briefsPages,
      briefsWatcher: boundWriter(scoped, artifactSource('brief')),
      briefsSerializer,
      pageVersions,
      chatService,
      releaseService: {
        getLatestReleaseName: () => 'r1',
        getRelease: (name: string) => ({ name }),
      } as unknown as ReleaseService,
      frontmatterIndexer,
      ws: fakeWs,
    });

    app = express()
      .use(express.json())
      .use('/api/briefs', briefsRouter(briefService, chatService))
      .use(errorHandler);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('answers with a full BriefResponse whose threads[0] is the initial thread', async () => {
    const res = await request(app)
      .post('/api/briefs')
      .send({ fromReleaseName: 'r1', toReleaseName: 'r2' });

    expect(res.status).toBe(200);
    const brief = res.body.data;
    expect(brief).toMatchObject({
      path: expect.any(String),
      frontmatter: expect.objectContaining({ from_release: 'r1', to_release: 'r2' }),
      body: expect.any(String),
      content: expect.any(String),
      hash: expect.any(String),
    });
    // The shape runAgent create-mode reads — a top-level thread, not a bare id field.
    expect(Array.isArray(brief.threads)).toBe(true);
    expect(brief.threads).toHaveLength(1);
    expect(brief.threads[0].id).toEqual(expect.any(String));
    expect(brief).not.toHaveProperty('initialThreadId');
    expect(brief).not.toHaveProperty('briefPath');
  });

  /**
   * The most common call after 0.2.64: no window at all. The server fills in
   * `from` from the latest release and leaves `to` open — a brief against the
   * current state, with nothing on the wire naming that provenance.
   */
  it('[ac:ac-post-api-briefs-przyjmuje-opcjonalne-po] accepts an empty body — window open to the current state, `from` resolved to latest', async () => {
    const res = await request(app).post('/api/briefs').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.frontmatter).toMatchObject({ from_release: 'r1', to_release: null });
    expect(res.body.data.frontmatter).not.toHaveProperty('source');
    expect(res.body.data.threads[0].title).toBe('Brief: r1 → (unreleased)');
  });

  it('rejects a window with neither end with VALIDATION', async () => {
    const res = await request(app)
      .post('/api/briefs')
      .send({ fromReleaseName: null, toReleaseName: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects from === to with BRIEF_SAME_RELEASE', async () => {
    const res = await request(app)
      .post('/api/briefs')
      .send({ fromReleaseName: 'r1', toReleaseName: 'r1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BRIEF_SAME_RELEASE');
  });
});
