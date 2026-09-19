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
import { PlanService } from '../services/plan.js';
import { plansRouter } from './plans.js';
import { errorHandler } from './errors.js';
import { PLAN_ROOT_MARKER } from '../../shared/types.js';
import type { WsEmitter } from '../ws/project-emitter.js';

const fakeWs = { broadcast: () => {} } as unknown as WsEmitter;

/**
 * 0.2.98 — `POST /api/plans` (`create_plan` over REST): `PlanCreateRequest` in,
 * `201 PlanResponse` out. No `threadId` in the request — the carrier thread is
 * founded by the call.
 */
describe('plansRouter — POST /api/plans', () => {
  let cwd: string;
  let db: Database.Database;
  let app: express.Express;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plans-route-test-'));
    db = new Database(':memory:');
    runMigrations(db);
    const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
    await plansPages.ensureRoot();
    const watchRuntime = new FileWatchRuntime({ fsEvents: false });
    watchRuntime.mountSource({ source: artifactSource('plan'), dir: plansPages.root, scope: 'context:test' });
    const plansSerializer = new FileSerializer(plansPages);
    const planService = new PlanService({
      plansPages,
      plansWatcher: boundWriter(watchRuntime.scoped('context:test'), artifactSource('plan')),
      plansSerializer,
      pageVersions: new FileVersionService(db, plansSerializer),
      chatService: new ChatService(db),
      frontmatterIndexer: new PagesFrontmatterIndexer(new Map([[PLAN_ROOT_MARKER, plansPages]]), fakeWs),
      ws: fakeWs,
    });
    app = express().use(express.json()).use('/api/plans', plansRouter(planService)).use(errorHandler);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('201 with { planPath, hash, threads: [carrier] }', async () => {
    const res = await request(app).post('/api/plans').send({ title: 'Rollout', content: '## A\n\nbody\n' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ planPath: 'rollout.md', hash: expect.stringMatching(/^[0-9a-f]{64}$/), threads: [expect.any(String)] });
    const row = db.prepare(`SELECT context_type, plan_path, parent_thread_id FROM chat_thread`).get();
    expect(row).toEqual({ context_type: 'chat', plan_path: 'rollout.md', parent_thread_id: null });
  });

  it('409 PLAN_ALREADY_EXISTS on a taken slug', async () => {
    await request(app).post('/api/plans').send({ title: 'Twice', content: 'x' });
    const res = await request(app).post('/api/plans').send({ title: 'Twice', content: 'y' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_ALREADY_EXISTS');
  });

  it('400 INVALID_ARGUMENT for a missing title and for blank content', async () => {
    const noTitle = await request(app).post('/api/plans').send({ content: 'x' });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.code).toBe('INVALID_ARGUMENT');
    const blank = await request(app).post('/api/plans').send({ title: 'Blank', content: '  ' });
    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe('INVALID_ARGUMENT');
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_thread`).get()).toEqual({ n: 0 });
  });
});
