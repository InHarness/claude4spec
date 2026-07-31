/**
 * 0.2.4 — `projectStamp` is the backstop that keeps `row.created_at ===
 * file.createdAt` true for types whose SQL the host does not own.
 *
 * Both cases below are ones the first implementation got wrong in ways no
 * existing test could see: it compared NORMALIZED values (so legacy SQLite text
 * survived forever in a column that is sorted as TEXT), and it warned whenever
 * it wrote (so a path where the host is the sole writer libelled a compliant
 * type and burned its one warning slot).
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStamp, resetProjectionWarnings } from './system-stamp-projection.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

const STAMP = { createdAt: '2026-07-31T12:00:00.000Z', updatedAt: '2026-07-31T13:00:00.000Z' };

function hostFor(type: string, table: string): ProjectPluginHost {
  return {
    getAvailable: (t: string) =>
      t === type ? ({ type, table, composition: undefined } as never) : null,
  } as unknown as ProjectPluginHost;
}

describe('projectStamp', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE ac (slug TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT)`);
    resetProjectionWarnings();
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('rewrites a legacy SQLite timestamp into ISO form even though both denote the same instant', () => {
    // The pre-fix comparison normalized both sides, called them equal, and left
    // the column mixed. `ORDER BY created_at` is a byte-wise TEXT sort in which
    // `' '` (0x20) precedes `'T'` (0x54), so one table holding both forms puts
    // every space-separated row ahead of every ISO one regardless of instant.
    db.prepare(`INSERT INTO ac (slug, created_at, updated_at) VALUES (?,?,?)`).run(
      'legacy',
      '2026-07-31 12:00:00',
      '2026-07-31 13:00:00',
    );

    expect(projectStamp(db, hostFor('ac', 'ac'), 'ac', 'legacy', STAMP)).toBe(true);

    const row = db.prepare(`SELECT created_at, updated_at FROM ac WHERE slug = ?`).get('legacy') as {
      created_at: string;
      updated_at: string;
    };
    expect(row.created_at).toBe(STAMP.createdAt);
    expect(row.updated_at).toBe(STAMP.updatedAt);
  });

  it('is a no-op when the column already holds the exact text', () => {
    db.prepare(`INSERT INTO ac (slug, created_at, updated_at) VALUES (?,?,?)`).run(
      'ok',
      STAMP.createdAt,
      STAMP.updatedAt,
    );
    expect(projectStamp(db, hostFor('ac', 'ac'), 'ac', 'ok', STAMP)).toBe(false);
  });

  it('does not warn when the host is the sole writer', () => {
    // The release-restore `noop` branch: no service ran, so a write here proves
    // nothing about the type's SQL. Warning would send an operator to debug a
    // non-bug AND permanently mute the once-per-type signal.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.prepare(`INSERT INTO ac (slug, created_at, updated_at) VALUES (?,?,?)`).run('x', 'a', 'b');

    projectStamp(db, hostFor('ac', 'ac'), 'ac', 'x', STAMP);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns only when a service was supposed to have written the stamp itself', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.prepare(`INSERT INTO ac (slug, created_at, updated_at) VALUES (?,?,?)`).run('x', 'a', 'b');

    projectStamp(db, hostFor('ac', 'ac'), 'ac', 'x', STAMP, { expectServiceWrote: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('did not honour the supplied stamp');
  });

  it('does not warn when the only difference was the text FORM, not the instant', () => {
    // Normalizing `2026-07-31 12:00:00` to its ISO spelling is the host tidying
    // up after a legacy column default — not evidence the service is broken.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.prepare(`INSERT INTO ac (slug, created_at, updated_at) VALUES (?,?,?)`).run(
      'legacy',
      '2026-07-31 12:00:00',
      '2026-07-31 13:00:00',
    );

    expect(projectStamp(db, hostFor('ac', 'ac'), 'ac', 'legacy', STAMP, { expectServiceWrote: true })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
