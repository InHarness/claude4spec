import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { backfillPlansToFilesystem } from '../../../src/server/workspace/plan-migration.js';
import { PagesService } from '../../../src/server/services/pages.js';
import { PLAN_ROOT_MARKER } from '../../../src/shared/types.js';

interface Harness {
  cwd: string;
  db: Database.Database;
  plansPages: PagesService;
}

async function setup(): Promise<Harness> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plan-migration-test-'));
  const db = createTestDb();
  const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
  await plansPages.ensureRoot();
  return { cwd, db, plansPages };
}

async function teardown(h: Harness): Promise<void> {
  h.db.close();
  await fs.rm(h.cwd, { recursive: true, force: true });
}

describe('backfillPlansToFilesystem', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('backfills chat_thread.plan_path WITH the .md extension, matching the file actually written to disk', async () => {
    h.db.prepare(`INSERT INTO chat_thread (id) VALUES ('t1')`).run();
    const planId = h.db
      .prepare(
        `INSERT INTO plan (title, content, created_at) VALUES ('My Legacy Plan', '# My Legacy Plan\n\nbody', datetime('now'))`,
      )
      .run().lastInsertRowid as number;
    h.db.prepare(`UPDATE chat_thread SET plan_id = ? WHERE id = 't1'`).run(planId);

    await backfillPlansToFilesystem({ db: h.db, plansPages: h.plansPages, backupDb: () => {} });

    const row = h.db.prepare(`SELECT plan_path FROM chat_thread WHERE id = 't1'`).get() as {
      plan_path: string | null;
    };
    expect(row.plan_path).not.toBeNull();
    expect(row.plan_path).toMatch(/\.md$/);

    // The exact bug this guards against: plan_path must resolve to a real
    // file — a bare slug without `.md` would pass a naive non-null check but
    // fail `PagesService.exists()` (and every PlanService.getByPath() lookup)
    // for a file that genuinely exists on disk.
    expect(await h.plansPages.exists(row.plan_path!)).toBe(true);

    const files = await h.plansPages.listMarkdownFiles();
    expect(files).toContain(row.plan_path);
  });

  it('drops the legacy plan/plan_version tables and plan_id/last_seen_plan_version columns after migrating', async () => {
    h.db.prepare(`INSERT INTO chat_thread (id) VALUES ('t1')`).run();
    const planId = h.db
      .prepare(`INSERT INTO plan (title, content, created_at) VALUES ('P', 'body', datetime('now'))`)
      .run().lastInsertRowid as number;
    h.db.prepare(`UPDATE chat_thread SET plan_id = ? WHERE id = 't1'`).run(planId);

    await backfillPlansToFilesystem({ db: h.db, plansPages: h.plansPages, backupDb: () => {} });

    const legacyTables = h.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('plan','plan_version')`)
      .all();
    expect(legacyTables).toHaveLength(0);

    const columns = h.db.prepare(`PRAGMA table_info(chat_thread)`).all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).not.toContain('plan_id');
    expect(names).not.toContain('last_seen_plan_version');
    expect(names).toContain('plan_path');
  });

  it('is a no-op on a project with no legacy plan table', async () => {
    // createTestDb() always creates `plan` via migration 014 — simulate an
    // already-migrated project by dropping it first, mirroring what a second
    // boot after migration would see.
    h.db.exec(`DROP TABLE IF EXISTS plan_version; DROP TABLE IF EXISTS plan;`);
    await expect(
      backfillPlansToFilesystem({ db: h.db, plansPages: h.plansPages, backupDb: () => {} }),
    ).resolves.toBeUndefined();
    expect(await h.plansPages.listMarkdownFiles()).toEqual([]);
  });
});
