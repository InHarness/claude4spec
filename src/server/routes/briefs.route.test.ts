import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { MarkdownFileStore } from '../services/pages.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { ChatService } from '../services/chat.js';
import { BriefService } from '../services/brief.js';
import { briefsRouter } from './briefs.js';
import { errorHandler } from './errors.js';
import { systemRootId } from '../../shared/root-kinds.js';
import type { ReleaseService } from '../services/release.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { BriefCreateRequest, BriefResponse } from '../../shared/entities.js';

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

    const briefsPages = new MarkdownFileStore({ cwd, dir: 'briefs', rootId: systemRootId('briefs'), kind: 'briefs' });
    await briefsPages.ensureRoot();
    const watchRuntime = new FileWatchRuntime({ fsEvents: false });
    const scoped = watchRuntime.scoped('context:test');
    watchRuntime.mountSource({ source: artifactSource('brief'), dir: briefsPages.root, scope: 'context:test' });
    const briefsSerializer = new FileSerializer(briefsPages);
    const pageVersions = new FileVersionService(db, briefsSerializer);
    const frontmatterIndexer = new PagesFrontmatterIndexer(
      new Map([[systemRootId('briefs'), briefsPages]]),
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

  /**
   * 0.2.94 — the second way a brief is born: the caller already wrote it. The
   * body is stored verbatim, the initial thread is opened all the same (it is
   * the `brief-detail` shell's anchor), and no turn runs.
   */
  it('stores a supplied `content` verbatim and still mints the initial thread', async () => {
    const content = '# Drift on X\n\n## What the spec says\n\n`a | b` — verbatim.\n';
    const res = await request(app).post('/api/briefs').send({ content });

    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe(content);
    expect(res.body.data.content).toContain(content);
    expect(res.body.data.frontmatter).toMatchObject({ from_release: 'r1', to_release: null });
    expect(res.body.data.threads).toHaveLength(1);
    // The thread is an anchor, not a request to write: nothing was said in it.
    expect(res.body.data.threads[0].id).toEqual(expect.any(String));
  });

  it('rejects a blank `content` with VALIDATION and writes no brief', async () => {
    const before = await fs.readdir(path.join(cwd, 'briefs'));
    const res = await request(app).post('/api/briefs').send({ content: '   \n' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    await expect(fs.readdir(path.join(cwd, 'briefs'))).resolves.toEqual(before);
  });

  it('rejects a non-string `content` with VALIDATION', async () => {
    const res = await request(app).post('/api/briefs').send({ content: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects a window with neither end with VALIDATION', async () => {
    const res = await request(app)
      .post('/api/briefs')
      .send({ fromReleaseName: null, toReleaseName: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  /**
   * 2.1.27 — `post-api-briefs` (tag `m21`): the request DTO is
   * `brief-create-request`, the 200 response DTO is `brief-response`, and the
   * route — not `create_brief` — opens the initial thread: top-level, no turn.
   */
  it('[entity:post-api-briefs] POST /api/briefs takes a BriefCreateRequest and answers 200 with a BriefResponse; it composes the file write with a top-level initial thread (context_type brief, no parent, no turn) listed first; 400 VALIDATION for a window with no end or blank content, 400 BRIEF_SAME_RELEASE for equal ends', async () => {
    const payload: BriefCreateRequest = { fromReleaseName: 'r1', toReleaseName: 'r2', content: '# Drift\n' };
    const res = await request(app).post('/api/briefs').send(payload);

    expect(res.status).toBe(200);
    const data: BriefResponse = res.body.data;
    // The response DTO's fields, all of them and nothing else (no bare thread id).
    expect(Object.keys(data).sort()).toEqual(['body', 'content', 'frontmatter', 'hash', 'path', 'threads']);
    expect(data.body).toBe('# Drift\n');
    expect(data.frontmatter).toMatchObject({ type: 'brief', from_release: 'r1', to_release: 'r2', implemented: false });

    // The initial thread: one brief thread, top-level, and nothing said in it.
    const rows = db
      .prepare('SELECT id, context_type, parent_thread_id FROM chat_thread WHERE brief_path = ?')
      .all(data.path) as Array<{ id: string; context_type: string; parent_thread_id: string | null }>;
    expect(rows).toHaveLength(1);
    const initial = rows[0]!;
    expect(initial).toMatchObject({ context_type: 'brief', parent_thread_id: null });
    expect(data.threads.map((t) => t.id)).toEqual([initial.id]);
    expect(data.threads[0]?.contextType).toBe('brief');
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE thread_id = ?').get(initial.id) as { n: number }).n,
    ).toBe(0);

    // Re-created under the same path, the NEW initial thread leads the list.
    await fs.rm(path.join(cwd, 'briefs', data.path));
    const again = await request(app).post('/api/briefs').send(payload);
    expect(again.status).toBe(200);
    const againData: BriefResponse = again.body.data;
    expect(againData.path).toBe(data.path);
    expect(againData.threads).toHaveLength(2);
    expect(againData.threads[0]?.id).not.toBe(initial.id);
    expect(againData.threads[1]?.id).toBe(initial.id);

    for (const [body, code] of [
      [{ fromReleaseName: null, toReleaseName: null }, 'VALIDATION'],
      [{ content: '  \n' }, 'VALIDATION'],
      [{ fromReleaseName: 'r1', toReleaseName: 'r1' }, 'BRIEF_SAME_RELEASE'],
    ] as Array<[BriefCreateRequest, string]>) {
      const bad = await request(app).post('/api/briefs').send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.error.code).toBe(code);
    }
  });

  it('rejects from === to with BRIEF_SAME_RELEASE', async () => {
    const res = await request(app)
      .post('/api/briefs')
      .send({ fromReleaseName: 'r1', toReleaseName: 'r1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BRIEF_SAME_RELEASE');
  });
});
