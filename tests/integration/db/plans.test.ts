import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { PlanService } from '../../../src/server/services/plan.js';
import { ChatService } from '../../../src/server/services/chat.js';
import { PagesService } from '../../../src/server/services/pages.js';
import { PagesWatcher } from '../../../src/server/fs/watcher.js';
import { FileSerializer } from '../../../src/server/services/file-serializer.js';
import { FileVersionService } from '../../../src/server/services/file-version.js';
import { PagesFrontmatterIndexer } from '../../../src/server/services/pages-frontmatter-indexer.js';
import { ANCHOR_PATTERN_SOURCE } from '../../../src/shared/anchor-pattern.js';
import { PLAN_ROOT_MARKER } from '../../../src/shared/types.js';
import type { WsEmitter } from '../../../src/server/ws/project-emitter.js';

const noopWs: WsEmitter = { broadcast: () => {} };
const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const HEADING_RE = /^(#{2,4})\s+(.+?)\s*$/;

function seedThread(db: Database.Database, id: string): void {
  db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run(id);
}

interface Harness {
  cwd: string;
  db: Database.Database;
  service: PlanService;
  plansPages: PagesService;
}

/** `ws` overrides only the PlanService-level dep — the watcher/indexer stay on
 *  `noopWs` so tests asserting on broadcasts see just PlanService's own calls. */
async function setup(ws: WsEmitter = noopWs): Promise<Harness> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plans-test-'));
  const db = createTestDb();
  const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
  await plansPages.ensureRoot();
  const plansWatcher = new PagesWatcher(plansPages.root, noopWs, PLAN_ROOT_MARKER);
  const plansSerializer = new FileSerializer(plansPages);
  const pageVersions = new FileVersionService(db, plansSerializer);
  const frontmatterIndexer = new PagesFrontmatterIndexer(
    new Map([[PLAN_ROOT_MARKER, plansPages]]),
    noopWs,
  );
  const chatService = new ChatService(db);
  const service = new PlanService({
    plansPages,
    plansWatcher,
    plansSerializer,
    pageVersions,
    chatService,
    frontmatterIndexer,
    ws,
  });
  return { cwd, db, service, plansPages };
}

async function teardown(h: Harness): Promise<void> {
  h.db.close();
  await fs.rm(h.cwd, { recursive: true, force: true });
}

/** Reads the body (frontmatter stripped) of the ONE plan file on disk — every test here seeds exactly one plan. */
async function soleStoredBody(h: Harness): Promise<string> {
  const files = await h.plansPages.listMarkdownFiles();
  expect(files).toHaveLength(1);
  const plan = await h.service.getByPath(files[0]!);
  return plan.body;
}

describe('PlanService anchor injection', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('[ac:ac-anchor-injection-w-nowych-headingach-pla] injects an anchor before every new plan heading on save, never duplicating an existing one', async () => {
    seedThread(h.db, 'thread-1');

    // Pierwszy zapis: dwa nagłówki bez kotwic — injection musi je dodać przed zapisem.
    await h.service.update({
      threadId: 'thread-1',
      title: 'Anchor injection plan',
      action: 'replace',
      content: '## First section\n\nbody text\n\n### Nested section\n\nmore body',
      changedBy: 'agent',
    });

    const saved = await soleStoredBody(h);
    const lines = saved.split('\n');
    const headingLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => HEADING_RE.test(line));

    expect(headingLines).toHaveLength(2);
    // Każdy nagłówek poprzedzony świeżo wstrzykniętą kotwicą.
    for (const { i } of headingLines) {
      expect(i).toBeGreaterThan(0);
      expect(ANCHOR_RE.test(lines[i - 1]!)).toBe(true);
    }

    // Drugi zapis tej samej treści (z już obecnymi kotwicami) nie dubluje kotwic.
    await h.service.update({
      threadId: 'thread-1',
      action: 'replace',
      content: saved,
      changedBy: 'user',
    });

    const resaved = await soleStoredBody(h);
    const anchorCount = resaved
      .split('\n')
      .filter((line) => ANCHOR_RE.test(line)).length;
    expect(anchorCount).toBe(2);
  });
});

describe('PlanService.getByAnchor', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  async function firstAnchorOf(): Promise<string> {
    const body = await soleStoredBody(h);
    const line = body.split('\n').find((l) => ANCHOR_RE.test(l))!;
    return ANCHOR_RE.exec(line)![1]!;
  }

  it('resolves an injected plan heading anchor back to its plan + oldest thread', async () => {
    seedThread(h.db, 'thread-1');
    await h.service.update({
      threadId: 'thread-1',
      title: 'Anchor resolve plan',
      action: 'replace',
      content: '## First section\n\nbody text',
      changedBy: 'agent',
    });
    const anchor = await firstAnchorOf();

    const hit = await h.service.getByAnchor(anchor);
    expect(hit).not.toBeNull();
    const plan = (await h.service.getByThread('thread-1'))!;
    expect(hit!.planPath).toBe(plan.path);
    expect(hit!.threadId).toBe('thread-1');
  });

  it('returns null for an unknown anchor and for a malformed anchor', async () => {
    seedThread(h.db, 'thread-1');
    await h.service.update({
      threadId: 'thread-1',
      title: 'Only section plan',
      action: 'replace',
      content: '## Only section\n\nbody',
      changedBy: 'agent',
    });

    expect(await h.service.getByAnchor('zzzzzzzz')).toBeNull(); // well-formed but absent
    expect(await h.service.getByAnchor('bad id!')).toBeNull(); // malformed → rejected by guard
    expect(await h.service.getByAnchor('%')).toBeNull(); // LIKE wildcard must not match everything
  });
});

// 0.1.127: threadCount/lastThreadId are PlanService-level concerns — the
// generic /api/artifacts/plan wire shape (ArtifactListItem) doesn't carry
// them (see brief 0-1-126-to-0-1-127's drift notes), so this AC is verified
// directly against the service instead of over HTTP.
describe('PlanService.listPlans', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('[ac:ac-planservice-listplans-search-limit] list items carry threadCount and lastThreadId, sorted DESC by updated_at', async () => {
    seedThread(h.db, 'seed-old');
    await h.service.update({
      threadId: 'seed-old',
      title: 'Old plan',
      action: 'replace',
      content: 'old',
      changedBy: 'agent',
    });
    const oldPlan = (await h.service.getByThread('seed-old'))!;
    // listPlans() sorts by the plan's own last-modified time (the file_version
    // log's latest entry for the path), not thread activity — push it back.
    h.db
      .prepare(`UPDATE file_version SET created_at = datetime('now', '-1 day') WHERE path = ? AND rootId = 'plan'`)
      .run(oldPlan.path);
    h.db.prepare(`UPDATE chat_thread SET updated_at = datetime('now', '-1 day') WHERE id = 'seed-old'`).run();

    seedThread(h.db, 'thread-1');
    await h.service.update({
      threadId: 'thread-1',
      title: 'Fresh plan',
      action: 'replace',
      content: 'fresh',
      changedBy: 'agent',
    });
    const freshPlan = (await h.service.getByThread('thread-1'))!;
    h.db
      .prepare(
        `INSERT INTO chat_thread (id, title, plan_path, created_at, updated_at)
         VALUES ('thread-2', 't2', ?, datetime('now'), datetime('now'))`,
      )
      .run(freshPlan.path);
    h.db.prepare(`UPDATE chat_thread SET updated_at = datetime('now', '-1 hour') WHERE id = 'thread-1'`).run();

    const list = h.service.listPlans({ includeThreadInfo: true });
    expect(list.map((p) => p.path)).toEqual([freshPlan.path, oldPlan.path]);
    const fresh = list[0]!;
    expect(fresh.threadCount).toBe(2);
    expect(fresh.lastThreadId).toBe('thread-2');
    expect(list[1]!.threadCount).toBe(1);
    expect(list[1]!.lastThreadId).toBe('seed-old');
  });
});

describe('PlanService.update — concurrent first-time creation (regression)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('two DIFFERENT threads creating a first plan with the SAME title concurrently both survive as distinct files (no silent clobber)', async () => {
    // Regression: allocatePath's collision search used to run unprotected
    // across threads — the per-call lock was keyed by `thread:${threadId}`,
    // which only serializes calls FROM THE SAME thread. Two different threads
    // racing on the same title could both observe "no existing file" and both
    // write to the exact same candidate path, with the second write silently
    // destroying the first thread's content.
    seedThread(h.db, 'thread-a');
    seedThread(h.db, 'thread-b');

    const [resultA, resultB] = await Promise.all([
      h.service.update({
        threadId: 'thread-a',
        title: 'Race Plan',
        action: 'replace',
        content: 'content from thread A',
        changedBy: 'agent',
      }),
      h.service.update({
        threadId: 'thread-b',
        title: 'Race Plan',
        action: 'replace',
        content: 'content from thread B',
        changedBy: 'agent',
      }),
    ]);

    // Neither write clobbered the other — two distinct plan files exist.
    expect(resultA.plan.path).not.toBe(resultB.plan.path);
    const files = await h.plansPages.listMarkdownFiles();
    expect(files).toHaveLength(2);

    // Each thread's own content survived under its own path, unmodified by
    // the other thread's concurrent write.
    const planA = (await h.service.getByThread('thread-a'))!;
    const planB = (await h.service.getByThread('thread-b'))!;
    expect(planA.body.trim()).toBe('content from thread A');
    expect(planB.body.trim()).toBe('content from thread B');
  });
});

describe('PlanService.updateContent — broadcasts plans:changed (regression)', () => {
  it('a body-only save (no frontmatter change) still broadcasts, so other open tabs/viewers refresh', async () => {
    // Regression: the indexer only broadcasts `plans:changed` when
    // *frontmatter* differs — a body-only PlanEditor save (the common case)
    // used to emit nothing at all, leaving every other viewer of this plan
    // silently stale until manual reload.
    const broadcast = vi.fn();
    const h = await setup({ broadcast });
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Broadcast plan',
        action: 'replace',
        content: 'original body',
        changedBy: 'agent',
      });
      broadcast.mockClear(); // drop the create-time plan:updated call — only asserting on updateContent below

      const plan = (await h.service.getByThread('thread-1'))!;
      await h.service.updateContent({
        path: plan.path,
        content: plan.content.replace('original body', 'edited body'),
        changedBy: 'user',
      });

      expect(broadcast).toHaveBeenCalledWith({ kind: 'plans:changed', path: plan.path });
    } finally {
      await teardown(h);
    }
  });
});
