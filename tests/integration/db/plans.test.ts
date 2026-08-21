import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { PlanService, injectAnchors } from '../../../src/server/services/plan.js';
import { ChatService } from '../../../src/server/services/chat.js';
import { PagesService } from '../../../src/server/services/pages.js';
import { FileWatchRuntime, type WatchSubscriber } from '../../../src/server/fs/watcher.js';
import { artifactSource, boundWriter } from '../../../src/server/fs/sources.js';
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
  frontmatterIndexer: PagesFrontmatterIndexer;
  watch: ReturnType<FileWatchRuntime['scoped']>;
}

/** `ws` overrides only the PlanService-level dep — the watcher/indexer stay on
 *  `noopWs` so tests asserting on broadcasts see just PlanService's own calls. */
async function setup(ws: WsEmitter = noopWs): Promise<Harness> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plans-test-'));
  const db = createTestDb();
  const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
  await plansPages.ensureRoot();
  const watchRuntime = new FileWatchRuntime({ fsEvents: false });
  watchRuntime.mountSource({ source: artifactSource('plan'), dir: plansPages.root, scope: 'context:test' });
  const watch = watchRuntime.scoped('context:test');
  const plansWatcher = boundWriter(watch, artifactSource('plan'));
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
  return { cwd, db, service, plansPages, frontmatterIndexer, watch };
}

/** Reads one named plan file's raw content. */
async function readPlanFile(h: Harness, rel: string): Promise<string> {
  return fs.readFile(path.join(h.plansPages.root, rel), 'utf-8');
}

/**
 * The `m06-plan-anchor-injection` write-back, built exactly as
 * `buildProjectContext` builds it — same `injectAnchors`, same `suppress()`
 * before the write.
 */
function planAnchorWriteBack(h: Harness): WatchSubscriber {
  return {
    onChange: async (_scope, source, relPath) => {
      const page = await h.plansPages.read(relPath);
      const injected = injectAnchors(page.body);
      if (injected === page.body) return;
      h.watch.suppress(source, relPath);
      await h.plansPages.write(relPath, { frontmatter: page.frontmatter, body: injected });
    },
    onUnlink: () => {},
  };
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
      expectedHash: await currentHash(h, 'thread-1'),
      content: saved,
      changedBy: 'user',
    });

    const resaved = await soleStoredBody(h);
    const anchorCount = resaved
      .split('\n')
      .filter((line) => ANCHOR_RE.test(line)).length;
    expect(anchorCount).toBe(2);
  });

  it('never injects an anchor that already occurs in the same plan file', async () => {
    seedThread(h.db, 'thread-dup');

    // 40 headings in one pass: every injected value is checked against the ones already
    // composed into THIS file (existing + injected earlier in the same pass), so the
    // minted set has to come out with no repeats.
    const headings = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\nbody ${i}`);
    await h.service.update({
      threadId: 'thread-dup',
      title: 'Anchor uniqueness plan',
      content: headings.join('\n\n'),
      changedBy: 'agent',
    });

    const saved = await soleStoredBody(h);
    const anchors = [...saved.matchAll(new RegExp(ANCHOR_PATTERN_SOURCE, 'g'))].map((m) => m[1]!);
    expect(anchors).toHaveLength(40);
    expect(new Set(anchors).size).toBe(40);
  });
});

/**
 * 0.2.15 — `update_plan` requires `expectedHash` on every call but the one that
 * creates the plan. These tests are about anchors and insertion, not about the
 * guard, so they read the current hash rather than asserting on it.
 */
async function currentHash(harness: Harness, threadId: string): Promise<string> {
  const plan = await harness.service.getByThread(threadId);
  if (!plan) throw new Error(`no plan attached to ${threadId}`);
  return plan.hash;
}

describe('PlanService.update — a section batch against a duplicated anchor', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  /**
   * A duplicate is only reachable by hand-writing or pasting one — generation cannot
   * produce it. It does NOT block the write (soft validation, as for pages); it only
   * makes a targeted edit ambiguous, and guessing a side would silently put the
   * fragment in the wrong section.
   */
  it('saves a plan carrying a duplicated anchor, then refuses to insert against it with AMBIGUOUS_ANCHOR', async () => {
    seedThread(h.db, 'thread-amb');

    const dup = 'abcd1234';
    await h.service.update({
      threadId: 'thread-amb',
      title: 'Ambiguous anchor plan',
      content:
        `<!-- anchor: ${dup} -->\n## First\n\nfirst body\n\n` +
        `<!-- anchor: ${dup} -->\n## Second\n\nsecond body`,
      changedBy: 'user',
    });

    // The write itself succeeded — the duplicate survived to disk unmodified.
    const saved = await soleStoredBody(h);
    expect(saved.split(`<!-- anchor: ${dup} -->`).length - 1).toBe(2);

    await expect(
      h.service.update({
        threadId: 'thread-amb',
        expectedHash: await currentHash(h, 'thread-amb'),
        edits: [{ anchor: dup, action: 'insert_after', content: 'injected fragment' }],
        changedBy: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ANCHOR' });
  });

  it('still inserts normally when the anchor occurs exactly once', async () => {
    seedThread(h.db, 'thread-one');

    await h.service.update({
      threadId: 'thread-one',
      title: 'Unique anchor plan',
      content: '<!-- anchor: aaaa1111 -->\n## Only\n\nonly body\n\n## Tail\n\ntail body',
      changedBy: 'user',
    });

    await h.service.update({
      threadId: 'thread-one',
      expectedHash: await currentHash(h, 'thread-one'),
      edits: [{ anchor: 'aaaa1111', action: 'insert_after', content: 'injected fragment' }],
      changedBy: 'agent',
    });

    const saved = await soleStoredBody(h);
    // Landed after the target section's whole subtree — before the next `##`, not at
    // the end of the file. (`insert_after`'s end rule, inherited from update_sections.)
    expect(saved.indexOf('injected fragment')).toBeLessThan(saved.indexOf('## Tail'));
  });

  it('reports SECTION_NOT_FOUND (not AMBIGUOUS_ANCHOR) when the anchor occurs zero times', async () => {
    seedThread(h.db, 'thread-none');

    await h.service.update({
      threadId: 'thread-none',
      title: 'Missing anchor plan',
      content: '## Only\n\nonly body',
      changedBy: 'user',
    });

    await expect(
      h.service.update({
        threadId: 'thread-none',
        expectedHash: await currentHash(h, 'thread-none'),
        edits: [{ anchor: 'zzzz9999', action: 'insert_after', content: 'injected fragment' }],
        changedBy: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'SECTION_NOT_FOUND' });
  });

  it('reads a duplicated anchor deterministically as the FIRST occurrence', async () => {
    seedThread(h.db, 'thread-read');

    const dup = 'bbbb2222';
    await h.service.update({
      threadId: 'thread-read',
      title: 'Duplicate read plan',
      content:
        `<!-- anchor: ${dup} -->\n## First\n\nfirst body\n\n` +
        `<!-- anchor: ${dup} -->\n## Second\n\nsecond body`,
      changedBy: 'user',
    });

    // Reads stay permissive where the write-path is strict: resolution is by first
    // occurrence, never a coin flip, so a duplicate degrades rather than breaking links.
    const hit = await h.service.getByAnchor(dup);
    expect(hit).not.toBeNull();
    expect(hit!.threadId).toBe('thread-read');
  });
});

describe('PlanService.update — a plan larger than the read budget', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  /**
   * 0.2.43 — the write path reads the WHOLE plan, never the budgeted read.
   *
   * `getByPath` caps its answer at the response budget while still hashing the
   * whole file, so an edit composed against that answer would pass the
   * `expectedHash` guard and then write the truncation back. Differential edits
   * make partial writes routine, so a long plan must survive a one-line change.
   */
  it('keeps everything past the response budget when a textEdits call rewrites one line', async () => {
    seedThread(h.db, 'thread-big');

    const filler = Array.from({ length: 3000 }, (_, i) => `line ${i} of ordinary plan prose`).join('\n');
    const body = `## Head\n\nneedle here\n\n${filler}\n\n## Tail\n\nthe very last words\n`;
    expect(body.length).toBeGreaterThan(60_000);

    await h.service.update({ threadId: 'thread-big', title: 'Big plan', content: body, changedBy: 'user' });

    await h.service.update({
      threadId: 'thread-big',
      expectedHash: await currentHash(h, 'thread-big'),
      textEdits: [{ find: 'needle here', replaceWith: 'NEEDLE FOUND' }],
      changedBy: 'agent',
    });

    // Raw bytes, not `soleStoredBody` — that helper reads through `getByPath`,
    // whose answer is budgeted and would hide the very truncation under test.
    const files = await h.plansPages.listMarkdownFiles();
    const saved = await readPlanFile(h, files[0]!);
    expect(saved).toContain('NEEDLE FOUND');
    expect(saved).toContain('the very last words');
    expect(saved).toContain('line 2999 of ordinary plan prose');
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
        content: 'content from thread A',
        changedBy: 'agent',
      }),
      h.service.update({
        threadId: 'thread-b',
        title: 'Race Plan',
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

describe('PlanService.updateContent — broadcasts plan:updated with changedBy user', () => {
  it('a body-only save (no frontmatter change) still broadcasts, so other open tabs/viewers refresh', async () => {
    // Regression: the indexer only broadcasts `plans:changed` when
    // *frontmatter* differs — a body-only PlanEditor save (the common case)
    // used to emit nothing at all, leaving every other viewer of this plan
    // silently stale until manual reload.
    //
    // 0.2.43: the event is `plan:updated`, not the coarser `plans:changed`. The
    // editor's save is the `content` variant made by a user, not a different
    // kind of write, so it publishes what plan writes publish — and it says who
    // made it. `threadId` is null because the editor is not a thread.
    const broadcast = vi.fn();
    const h = await setup({ broadcast });
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Broadcast plan',
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

      expect(broadcast).toHaveBeenCalledWith({
        kind: 'plan:updated',
        planPath: plan.path,
        threadId: null,
        version: 2,
        changedBy: 'user',
      });
    } finally {
      await teardown(h);
    }
  });
});

describe('M40 — plan anchor injection has one implementation and two triggers', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    await teardown(h);
  });

  it('[ac:ac-update-plan-action-insert-after-sectio] insert_after_section sees anchors immediately after the preceding save, with no debounce wait', async () => {
    seedThread(h.db, 't-sync');
    // First save mints the anchors. `PlanService.update` injects synchronously —
    // NOT as a write-back — precisely so the next call can target them at once.
    await h.service.update({
      threadId: 't-sync',
      title: 'Sync plan',
      content: '## Alpha\n\ntext\n\n## Beta\n\nmore\n',
      changedBy: 'agent',
    });
    const afterFirst = await soleStoredBody(h);
    const anchor = afterFirst.match(new RegExp(ANCHOR_PATTERN_SOURCE))?.[1];
    expect(anchor).toBeTruthy();

    // No timer advanced, no sleep: the very next call resolves that anchor.
    await h.service.update({
      threadId: 't-sync',
      expectedHash: await currentHash(h, 't-sync'),
      edits: [{ anchor: anchor!, action: 'insert_after', content: 'inserted body\n' }],
      changedBy: 'agent',
    });
    expect(await soleStoredBody(h)).toContain('inserted body');
  });

  /**
   * 0.2.15 — the guard that makes a plan safe to have several writers.
   *
   * The rationale is specific to plans: an agent turn, a save from the plan
   * editor and an N:1 model attach all write the same file, so last-write-wins here
   * loses authored content rather than merely reordering it.
   */
  it('requires expectedHash on an existing plan, and refuses a stale one with PLAN_CONFLICT', async () => {
    seedThread(h.db, 't-guard');
    await h.service.update({
      threadId: 't-guard',
      title: 'Guarded plan',
      content: 'original body\n',
      changedBy: 'agent',
    });
    const original = await soleStoredBody(h);

    // Missing → INVALID_ARGUMENT. Not PLAN_CONFLICT: retrying this exact call
    // can never work, so the caller needs "go read first", not a fresh hash.
    await expect(
      h.service.update({
        threadId: 't-guard',
        content: 'unguarded overwrite\n',
        changedBy: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    // Stale → PLAN_CONFLICT, carrying the current hash so the retry can arm.
    const conflict = await h.service
      .update({
        threadId: 't-guard',
        expectedHash: 'b'.repeat(64),
        content: 'stale overwrite\n',
        changedBy: 'agent',
      })
      .catch((e) => e);
    expect(conflict.code).toBe('PLAN_CONFLICT');
    expect(conflict.currentHash).toHaveLength(64);

    // Neither refusal wrote anything.
    expect(await soleStoredBody(h)).toBe(original);

    // The current hash is accepted, and the result carries the NEXT one — so a
    // caller can chain writes without a read between them.
    const ok = await h.service.update({
      threadId: 't-guard',
      expectedHash: await currentHash(h, 't-guard'),
      content: 'guarded overwrite\n',
      changedBy: 'agent',
    });
    expect(ok.hash).toHaveLength(64);
    expect(await soleStoredBody(h)).toContain('guarded overwrite');
    await expect(
      h.service.update({
        threadId: 't-guard',
        expectedHash: ok.hash,
        content: 'chained\n',
        changedBy: 'agent',
      }),
    ).resolves.toBeTruthy();
  });

  it('[ac:ac-zewnetrzny-zapis-pliku-planu-poza-plan] a plan written straight to disk gets its anchors from the M06 write-back on artifacts:plan', async () => {
    // Bypass PlanService entirely — this is an agent or a user editing plansDir.
    const rel = 'external-plan.md';
    await h.plansPages.write(rel, { frontmatter: { type: 'plan' }, body: '## Written outside\n\nbody\n' });
    expect(await readPlanFile(h, rel)).not.toMatch(new RegExp(ANCHOR_PATTERN_SOURCE));

    // The same `injectAnchors` implementation, reached as a write-back instead.
    const injection = planAnchorWriteBack(h);
    await injection.onChange('context:test', artifactSource('plan'), rel, 'external');

    expect(await readPlanFile(h, rel)).toMatch(new RegExp(ANCHOR_PATTERN_SOURCE));
  });
});

// 0.2.14 — the plan's execution flag. Everything here is about ONE claim:
// `applied` is a declaration, so nothing computes it and nothing about the
// plan's version history moves when it changes.
describe('PlanService — the `applied` flag (0.2.14)', () => {
  it('writes `applied: false` explicitly into a newly created plan file', async () => {
    const h = await setup();
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Fresh plan',
        content: 'body',
        changedBy: 'agent',
      });
      const plan = (await h.service.getByThread('thread-1'))!;
      expect(plan.frontmatter.applied).toBe(false);
      // Explicit in the FILE, not merely defaulted on read.
      expect(await readPlanFile(h, plan.path)).toMatch(/applied: false/);
    } finally {
      await teardown(h);
    }
  });

  it('reads a pre-0.2.14 plan (no `applied` key) as false, and the first write adds the key', async () => {
    const h = await setup();
    try {
      await fs.writeFile(
        path.join(h.plansPages.root, 'legacy.md'),
        `---\ntype: plan\ntitle: Legacy plan\ncreated_at: 2026-01-01T00:00:00.000Z\ncreated_by: user\n---\n\nbody\n`,
        'utf-8',
      );
      await h.frontmatterIndexer.indexPage(PLAN_ROOT_MARKER, 'legacy.md');

      const before = await h.service.getByPath('legacy.md');
      expect(before.frontmatter.applied).toBeUndefined();
      expect(h.service.listPlans({ applied: false }).map((p) => p.path)).toContain('legacy.md');
      expect(h.service.listPlans({ applied: true })).toHaveLength(0);

      await h.service.setAppliedByThread('no-such-thread', { path: 'legacy.md', applied: true });
      expect(await readPlanFile(h, 'legacy.md')).toMatch(/applied: true/);
    } finally {
      await teardown(h);
    }
  });

  it('setAppliedByThread resolves the plan from the thread and refuses to unset it', async () => {
    const h = await setup();
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Marked plan',
        content: 'body',
        changedBy: 'agent',
      });

      const res = await h.service.setAppliedByThread('thread-1', { applied: true });
      expect(res.applied).toBe(true);
      expect((await h.service.getByPath(res.path)).frontmatter.applied).toBe(true);

      // One-way from this channel: unsetting is the user's call in the UI.
      await expect(h.service.setAppliedByThread('thread-1', { applied: false })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    } finally {
      await teardown(h);
    }
  });

  it('NOT_FOUND when the thread has no plan and no explicit path was given', async () => {
    const h = await setup();
    try {
      seedThread(h.db, 'thread-1');
      await expect(h.service.setAppliedByThread('thread-1', { applied: true })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      await teardown(h);
    }
  });

  it('is idempotent — a repeat at the same value writes no file and emits no event', async () => {
    const broadcast = vi.fn();
    const h = await setup({ broadcast });
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Idempotent plan',
        content: 'body',
        changedBy: 'agent',
      });
      await h.service.setAppliedByThread('thread-1', { applied: true });
      const contentAfterFirst = await readPlanFile(h, (await h.service.getByThread('thread-1'))!.path);
      broadcast.mockClear();

      await h.service.setAppliedByThread('thread-1', { applied: true });

      expect(broadcast).not.toHaveBeenCalled();
      expect(await readPlanFile(h, (await h.service.getByThread('thread-1'))!.path)).toBe(contentAfterFirst);
    } finally {
      await teardown(h);
    }
  });

  it('a frontmatter write records NO new version, but still broadcasts plan:updated', async () => {
    const broadcast = vi.fn();
    const h = await setup({ broadcast });
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Versionless plan',
        content: 'body',
        changedBy: 'agent',
      });
      const before = (await h.service.getByThread('thread-1'))!;
      broadcast.mockClear();

      await h.service.setAppliedByThread('thread-1', { applied: true });

      const after = await h.service.getByPath(before.path);
      // The whole point: history is untouched by a declaration.
      expect(after.currentVersion).toBe(before.currentVersion);
      expect(broadcast).toHaveBeenCalledWith({
        kind: 'plan:updated',
        planPath: before.path,
        threadId: 'thread-1',
        version: before.currentVersion,
        changedBy: 'agent',
      });
    } finally {
      await teardown(h);
    }
  });

  it('a title rename likewise records no version (same frontmatter rule)', async () => {
    const h = await setup();
    try {
      seedThread(h.db, 'thread-1');
      await h.service.update({
        threadId: 'thread-1',
        title: 'Old title',
        content: 'body',
        changedBy: 'agent',
      });
      const before = (await h.service.getByThread('thread-1'))!;

      await h.service.updateFrontmatter({
        path: before.path,
        patch: { title: 'New title' },
        changedBy: 'user',
        // 0.2.15: the caller supplies the thread the event belongs to, or `null`
        // when the write is not thread-bound — it is no longer guessed here.
        threadId: null,
      });

      const after = await h.service.getByPath(before.path);
      expect(after.frontmatter.title).toBe('New title');
      expect(after.currentVersion).toBe(before.currentVersion);
    } finally {
      await teardown(h);
    }
  });
});

/**
 * 0.2.43 — the three input variants, at the level where the filesystem is real.
 *
 * The pure half of the batch engine (ordering, subtree rules, match scopes)
 * lives in `src/server/services/plan-write.test.ts`; what is here is everything
 * that needed a plan file, a version log and an event emitter to be true.
 */
describe('PlanService.update — three input variants', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  const SEED = '## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n';

  async function seedPlan(threadId: string): Promise<{ anchors: string[]; hash: string }> {
    seedThread(h.db, threadId);
    await h.service.update({ threadId, title: `Plan ${threadId}`, content: SEED, changedBy: 'agent' });
    const body = await soleStoredBody(h);
    return {
      anchors: [...body.matchAll(new RegExp(ANCHOR_PATTERN_SOURCE, 'g'))].map((m) => m[1]!),
      hash: await currentHash(h, threadId),
    };
  }

  it('refuses a call carrying no variant before it has looked at anything', async () => {
    seedThread(h.db, 't-none');
    await expect(
      h.service.update({ threadId: 't-none', title: 'X', changedBy: 'agent' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    // Nothing was created by the refusal.
    expect(h.service.listPlans()).toHaveLength(0);
  });

  /**
   * MISSING_TITLE is checked FIRST, in every variant. A thread with no plan has
   * no sections either, so answering `SECTION_NOT_FOUND` would send the caller
   * hunting for an anchor when what it actually failed to send was a name.
   */
  it.each([
    ['content', { content: 'x' }],
    ['textEdits', { textEdits: [{ find: 'x', replaceWith: 'y' }] }],
    ['edits', { edits: [{ anchor: 'aaaa1111', action: 'replace' as const, content: 'x' }] }],
  ])('answers MISSING_TITLE for the %s variant on a thread with no plan', async (name, variant) => {
    seedThread(h.db, `t-title-${name}`);
    await expect(
      h.service.update({ threadId: `t-title-${name}`, ...variant, changedBy: 'agent' }),
    ).rejects.toMatchObject({ code: 'MISSING_TITLE' });
    expect(h.service.listPlans()).toHaveLength(0);
  });

  /**
   * On an EMPTY plan only `content` can succeed — and the two that cannot must
   * refuse before a filename is reserved, or every rejected call would leave an
   * orphan plan behind.
   */
  it('answers SECTION_NOT_FOUND for a batch against a plan that does not exist yet, and creates nothing', async () => {
    seedThread(h.db, 't-empty-batch');
    await expect(
      h.service.update({
        threadId: 't-empty-batch',
        title: 'Empty batch plan',
        edits: [{ anchor: 'aaaa1111', action: 'append', content: 'x' }],
        changedBy: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'SECTION_NOT_FOUND' });
    expect(h.service.listPlans()).toHaveLength(0);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM file_version').get()).toMatchObject({ n: 0 });
  });

  it('answers FIND_NOT_FOUND for textEdits against a plan that does not exist yet, and creates nothing', async () => {
    seedThread(h.db, 't-empty-diff');
    await expect(
      h.service.update({
        threadId: 't-empty-diff',
        title: 'Empty diff plan',
        textEdits: [{ find: 'anything', replaceWith: 'x' }],
        changedBy: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'FIND_NOT_FOUND' });
    expect(h.service.listPlans()).toHaveLength(0);
  });

  it('counts a top-level textEdits over the WHOLE plan', async () => {
    const { hash } = await seedPlan('t-diff');
    const res = await h.service.update({
      threadId: 't-diff',
      expectedHash: hash,
      textEdits: [{ find: 'body', replaceWith: 'text', expectedMatches: 2 }],
      changeSummary: 'rename body to text',
      changedBy: 'agent',
    });
    expect(res.results).toEqual([
      { anchor: null, action: null, affectedAnchors: expect.any(Array), droppedAnchors: [], replacements: 2 },
    ]);
    const body = await soleStoredBody(h);
    expect(body).toContain('alpha text');
    expect(body).toContain('beta text');
  });

  it('answers one results row with a null anchor and a null action for the content variant', async () => {
    const { hash } = await seedPlan('t-content');
    const res = await h.service.update({
      threadId: 't-content',
      expectedHash: hash,
      content: '## Only\n\njust this\n',
      changeSummary: 'rewrite',
      changedBy: 'agent',
    });
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ anchor: null, action: null });
    expect(res.results[0]!.replacements).toBeUndefined();
  });

  /**
   * A batch is ALL OR NOTHING, and "nothing" has to mean the file, the version
   * log and the event stream alike — a caller told its batch was refused must
   * not find half of it applied, or a version row asserting that something was.
   */
  it('writes nothing at all when one entry of a batch is refused', async () => {
    const broadcast = vi.fn();
    const hh = await setup({ broadcast });
    try {
      seedThread(hh.db, 't-atomic');
      await hh.service.update({ threadId: 't-atomic', title: 'Atomic plan', content: SEED, changedBy: 'agent' });
      const before = await soleStoredBody(hh);
      const anchors = [...before.matchAll(new RegExp(ANCHOR_PATTERN_SOURCE, 'g'))].map((m) => m[1]!);
      const versionBefore = (await hh.service.getByThread('t-atomic'))!.currentVersion;
      broadcast.mockClear();

      await expect(
        hh.service.update({
          threadId: 't-atomic',
          expectedHash: await currentHash(hh, 't-atomic'),
          edits: [
            { anchor: anchors[0]!, action: 'replace', content: 'rewritten alpha' },
            { anchor: 'zzzz9999', action: 'append', content: 'to nowhere' },
          ],
          changeSummary: 'half-good batch',
          changedBy: 'agent',
        }),
      ).rejects.toMatchObject({ code: 'SECTION_NOT_FOUND' });

      expect(await soleStoredBody(hh)).toBe(before);
      expect((await hh.service.getByThread('t-atomic'))!.currentVersion).toBe(versionBefore);
      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      await teardown(hh);
    }
  });

  /**
   * One call is one act: N sections edited together are one version carrying one
   * `changeSummary`, not N of either.
   */
  it('captures exactly one version and one changeSummary for a batch touching two sections', async () => {
    const { anchors, hash } = await seedPlan('t-batch');
    const versionBefore = (await h.service.getByThread('t-batch'))!.currentVersion;
    const res = await h.service.update({
      threadId: 't-batch',
      expectedHash: hash,
      edits: [
        { anchor: anchors[1]!, action: 'append', content: 'more beta' },
        { anchor: anchors[0]!, action: 'replace', content: 'new alpha' },
      ],
      changeSummary: 'one summary for two sections',
      changedBy: 'agent',
    });
    expect(res.version).toBe(versionBefore + 1);
    // `results` comes back in the order GIVEN, not the bottom-up order applied.
    expect(res.results.map((r) => r.anchor)).toEqual([anchors[1], anchors[0]]);
    const summaries = h.db
      .prepare('SELECT change_summary FROM file_version ORDER BY version')
      .all() as Array<{ change_summary: string | null }>;
    expect(summaries.filter((s) => s.change_summary === 'one summary for two sections')).toHaveLength(1);
  });

  it('arms the next call with the hash it returns', async () => {
    const { hash } = await seedPlan('t-chain');
    const first = await h.service.update({
      threadId: 't-chain',
      expectedHash: hash,
      content: '## One\n\nfirst\n',
      changedBy: 'agent',
    });
    // No read in between: the returned hash IS the guard for the next write.
    await h.service.update({
      threadId: 't-chain',
      expectedHash: first.hash,
      content: '## Two\n\nsecond\n',
      changedBy: 'agent',
    });
    expect(await soleStoredBody(h)).toContain('second');
  });

  it('answers PLAN_NOT_FOUND, naming the plans it does have, for an explicit path that resolves to nothing', async () => {
    await seedPlan('t-known');
    await expect(
      h.service.update({
        threadId: 't-known',
        planPath: 'no-such-plan.md',
        expectedHash: 'whatever',
        content: 'x',
        changedBy: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  });
});
