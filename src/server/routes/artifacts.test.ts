import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { PagesService } from '../services/pages.js';
import { PagesWatcher } from '../fs/watcher.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { ChatService } from '../services/chat.js';
import { BriefService } from '../services/brief.js';
import { PatchService } from '../services/patch.js';
import { PlanService } from '../services/plan.js';
import { artifactsRouter } from './artifacts.js';
import { errorHandler } from './errors.js';
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, PLAN_ROOT_MARKER } from '../../shared/types.js';
import type { ReleaseService } from '../services/release.js';
import type { WsEmitter } from '../ws/project-emitter.js';

const fakeWs = { broadcast: () => {} } as unknown as WsEmitter;
const fakeReleaseService = {} as unknown as ReleaseService;

describe('artifactsRouter — /api/artifacts/:kind/*', () => {
  let cwd: string;
  let db: Database.Database;
  let app: express.Express;
  let briefsSerializer: FileSerializer;
  let patchesSerializer: FileSerializer;
  let pageVersions: FileVersionService;
  let frontmatterIndexer: PagesFrontmatterIndexer;

  const briefsDir = 'briefs';
  const patchesDir = 'patches';
  const plansDir = 'plans';

  async function writeArtifact(
    kind: 'brief' | 'patch',
    relPath: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<void> {
    const dir = kind === 'brief' ? briefsDir : patchesDir;
    const rootId = kind === 'brief' ? BRIEF_ROOT_MARKER : PATCH_ROOT_MARKER;
    const serializer = kind === 'brief' ? briefsSerializer : patchesSerializer;
    const abs = path.join(cwd, dir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, matter.stringify(body, frontmatter), 'utf-8');
    await frontmatterIndexer.indexPage(rootId, relPath);
    await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, serializer, rootId);
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-artifacts-test-'));
    db = new Database(':memory:');
    runMigrations(db);

    const briefsPages = new PagesService(cwd, briefsDir, BRIEF_ROOT_MARKER);
    await briefsPages.ensureRoot();
    const patchesPages = new PagesService(cwd, patchesDir, PATCH_ROOT_MARKER);
    await patchesPages.ensureRoot();
    const plansPages = new PagesService(cwd, plansDir, PLAN_ROOT_MARKER);
    await plansPages.ensureRoot();
    const briefsWatcher = new PagesWatcher(briefsPages.root, fakeWs, BRIEF_ROOT_MARKER);
    const patchesWatcher = new PagesWatcher(patchesPages.root, fakeWs, PATCH_ROOT_MARKER);
    const plansWatcher = new PagesWatcher(plansPages.root, fakeWs, PLAN_ROOT_MARKER);
    briefsSerializer = new FileSerializer(briefsPages);
    patchesSerializer = new FileSerializer(patchesPages);
    const plansSerializer = new FileSerializer(plansPages);
    pageVersions = new FileVersionService(db, briefsSerializer);
    const frontmatterRoots = new Map([
      [BRIEF_ROOT_MARKER, briefsPages],
      [PATCH_ROOT_MARKER, patchesPages],
      [PLAN_ROOT_MARKER, plansPages],
    ]);
    frontmatterIndexer = new PagesFrontmatterIndexer(frontmatterRoots, fakeWs);
    const chatService = new ChatService(db);

    const briefService = new BriefService({
      briefsPages,
      briefsWatcher,
      briefsSerializer,
      pageVersions,
      chatService,
      releaseService: fakeReleaseService,
      frontmatterIndexer,
      ws: fakeWs,
    });
    const patchService = new PatchService({
      patchesPages,
      patchesWatcher,
      patchesSerializer,
      pageVersions,
      chatService,
      frontmatterIndexer,
    });
    const planService = new PlanService({
      plansPages,
      plansWatcher,
      plansSerializer,
      pageVersions,
      chatService,
      frontmatterIndexer,
      ws: fakeWs,
    });

    app = express()
      .use(express.json())
      .use(
        '/api/artifacts',
        artifactsRouter({ brief: briefService, patch: patchService, plan: planService, pageVersions }),
      )
      .use(errorHandler);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('404s an unknown :kind with UNKNOWN_ARTIFACT_KIND', async () => {
    const res = await request(app).get('/api/artifacts/bogus');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNKNOWN_ARTIFACT_KIND');
  });

  describe('brief', () => {
    beforeEach(async () => {
      await writeArtifact(
        'brief',
        'v1-to-v2.md',
        {
          type: 'brief',
          source: 'release-diff',
          from_release: 'v1',
          to_release: 'v2',
          generated_at: '2026-01-01T00:00:00.000Z',
          generator_version: 'test',
          implemented: false,
        },
        '# Brief: v1 -> v2\n',
      );
    });

    it('GET /api/artifacts/brief lists with frontmatter + hash + updatedAt, filtered by ?implemented=', async () => {
      const all = await request(app).get('/api/artifacts/brief');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(1);
      expect(all.body.data[0]).toMatchObject({ path: 'v1-to-v2.md', frontmatter: { source: 'release-diff' } });
      expect(typeof all.body.data[0].hash).toBe('string');
      expect(all.body.data[0].hash.length).toBeGreaterThan(0);

      const implementedOnly = await request(app).get('/api/artifacts/brief?implemented=true');
      expect(implementedOnly.body.data).toHaveLength(0);

      const pendingOnly = await request(app).get('/api/artifacts/brief?implemented=false');
      expect(pendingOnly.body.data).toHaveLength(1);
    });

    it('GET /api/artifacts/brief/:path returns full detail with merged threads', async () => {
      const res = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      expect(res.status).toBe(200);
      expect(res.body.data.path).toBe('v1-to-v2.md');
      expect(res.body.data.frontmatter.from_release).toBe('v1');
      expect(res.body.data.body).toContain('Brief: v1 -> v2');
      expect(res.body.data.threads).toEqual([]);
    });

    it('GET /api/artifacts/brief/:path/versions lists captured versions', async () => {
      const res = await request(app).get('/api/artifacts/brief/v1-to-v2.md/versions');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].op).toBe('create');
    });

    it('PUT .../content updates on a hash match and returns the fresh ArtifactResponse', async () => {
      const detail = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      const newContent = matter.stringify('# Brief: v1 -> v2 (edited)\n', detail.body.data.frontmatter);

      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: newContent, expectedHash: detail.body.data.hash });

      expect(res.status).toBe(200);
      expect(res.body.data.body).toContain('edited');
      expect(res.body.data.hash).not.toBe(detail.body.data.hash);
    });

    it('PUT .../content 409s on a hash mismatch, with currentHash + currentContent', async () => {
      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: 'irrelevant', expectedHash: 'stale-hash' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BRIEF_CONFLICT');
      expect(typeof res.body.currentHash).toBe('string');
      expect(res.body.currentContent).toContain('Brief: v1 -> v2');
    });

    it('PUT .../content 400s VALIDATION (not a 409) when expectedHash is omitted', async () => {
      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: 'irrelevant' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('PATCH .../frontmatter accepts the mutable `implemented` key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { implemented: true } });

      expect(res.status).toBe(200);
      expect(res.body.data.frontmatter.implemented).toBe(true);
    });

    it('PATCH .../frontmatter 400s IMMUTABLE_FIELD on an immutable key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { source: 'analysis' } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMMUTABLE_FIELD');
    });

    it('POST .../threads creates a thread bound to this brief', async () => {
      const res = await request(app).post('/api/artifacts/brief/v1-to-v2.md/threads').send({ name: 'my thread' });
      expect(res.status).toBe(200);
      expect(typeof res.body.data.threadId).toBe('string');

      const detail = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      expect(detail.body.data.threads).toHaveLength(1);
      expect(detail.body.data.threads[0].title).toBe('my thread');
    });
  });

  describe('patch', () => {
    beforeEach(async () => {
      await writeArtifact(
        'patch',
        'v1-to-v2-drift.md',
        {
          type: 'patch',
          brief: 'v1-to-v2.md',
          patch_kind: 'drift',
          created_at: '2026-01-02T00:00:00.000Z',
          created_by: 'agent',
          status: 'awaiting',
        },
        '# Patch — drift\n',
      );
    });

    it('GET /api/artifacts/patch lists, filterable by ?status=', async () => {
      const all = await request(app).get('/api/artifacts/patch');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(1);
      expect(all.body.data[0].frontmatter.patch_kind).toBe('drift');

      const completedOnly = await request(app).get('/api/artifacts/patch?status=completed');
      expect(completedOnly.body.data).toHaveLength(0);
    });

    it('GET /api/artifacts/patch/:path returns detail (no top-level title)', async () => {
      const res = await request(app).get('/api/artifacts/patch/v1-to-v2-drift.md');
      expect(res.status).toBe(200);
      expect(res.body.data.frontmatter.patch_kind).toBe('drift');
      expect(res.body.data.title).toBeUndefined();
    });

    it('PATCH .../frontmatter accepts `status` and rejects an invalid value', async () => {
      const ok = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { status: 'completed' } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.frontmatter.status).toBe('completed');

      const badValue = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { status: 'bogus' } });
      expect(badValue.status).toBe(400);
      expect(badValue.body.error.code).toBe('VALIDATION');
    });

    it('PATCH .../frontmatter 400s IMMUTABLE_FIELD on an immutable key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { patch_kind: 'missing' } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMMUTABLE_FIELD');
    });
  });
});
