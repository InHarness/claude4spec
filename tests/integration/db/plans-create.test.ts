import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { PlanService } from '../../../src/server/services/plan.js';
import { ChatService } from '../../../src/server/services/chat.js';
import { PagesService } from '../../../src/server/services/pages.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { artifactSource, boundWriter } from '../../../src/server/fs/sources.js';
import { FileSerializer } from '../../../src/server/services/file-serializer.js';
import { FileVersionService } from '../../../src/server/services/file-version.js';
import { PagesFrontmatterIndexer } from '../../../src/server/services/pages-frontmatter-indexer.js';
import { hashContent } from '../../../src/server/services/artifact-content.js';
import { PLAN_ROOT_MARKER } from '../../../src/shared/types.js';
import type { WsEmitter } from '../../../src/server/ws/project-emitter.js';

/**
 * 0.2.98 — `PlanService.create` (`create_plan`): a plan born from outside a
 * conversation, with its carrier thread, all or nothing.
 */

interface Harness {
  cwd: string;
  db: Database.Database;
  service: PlanService;
  plansPages: PagesService;
  pageVersions: FileVersionService;
  chatService: ChatService;
  events: unknown[];
}

async function setup(): Promise<Harness> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plans-create-'));
  const db = createTestDb();
  const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
  await plansPages.ensureRoot();
  const watchRuntime = new FileWatchRuntime({ fsEvents: false });
  watchRuntime.mountSource({ source: artifactSource('plan'), dir: plansPages.root, scope: 'context:test' });
  const plansWatcher = boundWriter(watchRuntime.scoped('context:test'), artifactSource('plan'));
  const plansSerializer = new FileSerializer(plansPages);
  const pageVersions = new FileVersionService(db, plansSerializer);
  const noopWs: WsEmitter = { broadcast: () => {} };
  const frontmatterIndexer = new PagesFrontmatterIndexer(new Map([[PLAN_ROOT_MARKER, plansPages]]), noopWs);
  const chatService = new ChatService(db);
  const events: unknown[] = [];
  const service = new PlanService({
    plansPages,
    plansWatcher,
    plansSerializer,
    pageVersions,
    chatService,
    frontmatterIndexer,
    ws: { broadcast: (e) => void events.push(e) },
  });
  return { cwd, db, service, plansPages, pageVersions, chatService, events };
}

function threadRows(db: Database.Database) {
  return db
    .prepare(`SELECT id, context_type, plan_path, parent_thread_id FROM chat_thread`)
    .all() as { id: string; context_type: string; plan_path: string | null; parent_thread_id: string | null }[];
}

function messageCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM chat_message`).get() as { n: number }).n;
}

describe('PlanService.create (0.2.98 create_plan)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    h.db.close();
    await fs.rm(h.cwd, { recursive: true, force: true });
  });

  it('founds the file, ONE version and a top-level `chat` carrier thread bound by plan_path — and runs no turn', async () => {
    const res = await h.service.create({ title: 'Auth Rollout', content: '## Step one\n\nDo it.\n', changedBy: 'user' });

    expect(res.planPath).toBe('auth-rollout.md');
    const raw = await fs.readFile(path.join(h.plansPages.root, res.planPath), 'utf-8');
    expect(res.hash).toBe(hashContent(raw));
    expect(raw).toContain('## Step one');
    expect(raw).toMatch(/applied: false/);

    expect(h.pageVersions.listVersions(res.planPath, PLAN_ROOT_MARKER)).toHaveLength(1);

    const threads = threadRows(h.db);
    expect(threads).toEqual([
      { id: res.threads[0], context_type: 'chat', plan_path: 'auth-rollout.md', parent_thread_id: null },
    ]);
    expect(res.threads).toHaveLength(1);
    expect(messageCount(h.db)).toBe(0);

    // The hash arms the first update_plan with no read in between.
    const upd = await h.service.update({
      threadId: res.threads[0]!,
      planPath: res.planPath,
      content: '## Step one\n\nDone.\n',
      expectedHash: res.hash,
      changedBy: 'agent',
    });
    expect(upd.version).toBe(2);
  });

  it('broadcasts plan:updated with the carrier thread id — never null', async () => {
    const res = await h.service.create({ title: 'Broadcast', content: 'x', changedBy: 'agent' });
    expect(h.events).toEqual([
      { kind: 'plan:updated', planPath: res.planPath, threadId: res.threads[0], version: 1, changedBy: 'agent' },
    ]);
  });

  it('refuses a taken slug with PLAN_ALREADY_EXISTS: no suffix, the existing file untouched, no new thread', async () => {
    const first = await h.service.create({ title: 'Same Title', content: 'original', changedBy: 'user' });
    const before = await fs.readFile(path.join(h.plansPages.root, first.planPath), 'utf-8');

    await expect(h.service.create({ title: 'same  title', content: 'intruder', changedBy: 'user' })).rejects.toMatchObject({
      code: 'PLAN_ALREADY_EXISTS',
    });

    expect(await h.plansPages.listMarkdownFiles()).toEqual(['same-title.md']);
    expect(await fs.readFile(path.join(h.plansPages.root, first.planPath), 'utf-8')).toBe(before);
    expect(threadRows(h.db)).toHaveLength(1);
    expect(h.pageVersions.listVersions(first.planPath, PLAN_ROOT_MARKER)).toHaveLength(1);
  });

  it.each([
    ['omitted', undefined],
    ['empty', ''],
    ['whitespace only', '  \n\t '],
  ])('refuses %s content with INVALID_ARGUMENT and creates nothing', async (_label, content) => {
    await expect(
      h.service.create({ title: 'Blank', ...(content === undefined ? {} : { content }), changedBy: 'user' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await h.plansPages.listMarkdownFiles()).toEqual([]);
    expect(threadRows(h.db)).toEqual([]);
  });

  it('refuses a blank title with INVALID_ARGUMENT (not MISSING_TITLE)', async () => {
    await expect(h.service.create({ title: '   ', content: 'x', changedBy: 'user' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(threadRows(h.db)).toEqual([]);
  });

  it('is atomic: a failure after the thread and the file were written leaves no file, no version, no thread', async () => {
    const spy = vi
      .spyOn(PagesFrontmatterIndexer.prototype, 'indexPage')
      .mockRejectedValueOnce(new Error('index boom'));

    await expect(h.service.create({ title: 'Doomed', content: 'x', changedBy: 'user' })).rejects.toThrow('index boom');
    spy.mockRestore();

    expect(await h.plansPages.listMarkdownFiles()).toEqual([]);
    expect(h.pageVersions.listVersions('doomed.md', PLAN_ROOT_MARKER)).toEqual([]);
    expect(threadRows(h.db)).toEqual([]);
    expect(h.events).toEqual([]);

    // …and the slug is free again: the refusal did not reserve it.
    await expect(h.service.create({ title: 'Doomed', content: 'x', changedBy: 'user' })).resolves.toMatchObject({
      planPath: 'doomed.md',
    });
  });

  it('update_plan by explicit path with no thread in scope still writes, and broadcasts threadId: null', async () => {
    const res = await h.service.create({ title: 'External', content: 'v1', changedBy: 'user' });
    h.events.length = 0;
    await h.service.update({
      threadId: 'mcp-external',
      planPath: res.planPath,
      content: 'v2',
      expectedHash: res.hash,
      changedBy: 'agent',
    });
    expect(h.events).toEqual([
      { kind: 'plan:updated', planPath: res.planPath, threadId: null, version: 2, changedBy: 'agent' },
    ]);
  });
});
