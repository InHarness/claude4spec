import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/server/db/migrate.js';
import { openDbAt } from '../../../src/server/db/index.js';

describe('runMigrations', () => {
  it('applies every migration on a fresh database, in sorted order', () => {
    const db = new Database(':memory:');
    const applied = runMigrations(db);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0]).toBe('000_init');
    expect(applied).toEqual([...applied].sort());

    const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>;
    expect(rows.length).toBe(applied.length);
    db.close();
  });

  it('is idempotent: a second run applies nothing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(runMigrations(db)).toEqual([]);
    db.close();
  });

  it('restores PRAGMA foreign_keys after the batch when it was ON before', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});

describe('openDbAt', () => {
  it('opens a migrated in-memory database whose close() does not throw', () => {
    const db = openDbAt(':memory:');
    const count = db.handle
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as { n: number };
    expect(count.n).toBeGreaterThan(10);
    expect(() => db.close()).not.toThrow();
  });
});
