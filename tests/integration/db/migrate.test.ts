import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/server/db/migrate.js';
import { openDbAt } from '../../../src/server/db/index.js';

const versionsIn = (db: Database.Database): string[] =>
  (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>).map(
    (r) => r.version,
  );

const chainFiles = (): string[] =>
  fs
    .readdirSync(path.join(import.meta.dirname, '../../../src/server/db/migrations'))
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql')
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();

describe('runMigrations', () => {
  it('applies only the baseline on a fresh database, and records the chain as applied', () => {
    const db = new Database(':memory:');
    const applied = runMigrations(db);

    // 0.2.2 baseline cut: a fresh project never reconstructs history.
    expect(applied).toEqual(['000_baseline']);
    expect(versionsIn(db)).toEqual(['000_baseline', ...chainFiles()]);
    db.close();
  });

  it('skips the baseline on an existing database and replays the chain from where it stopped', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_migrations (version) VALUES ('000_init');
    `);
    db.exec("CREATE TABLE _init_marker (created_at TEXT NOT NULL DEFAULT (datetime('now')));");

    const applied = runMigrations(db);

    // The baseline must never touch an installed database — its schema comes
    // from the chain, and the two are only equivalent, not identical in path.
    expect(applied).not.toContain('000_baseline');
    expect(versionsIn(db)).not.toContain('000_baseline');
    expect(applied[0]).toBe('001_endpoint');
    expect(applied).toEqual(chainFiles().filter((v) => v !== '000_init'));

    // The legacy path still creates entity tables; only the baseline drops them.
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'endpoint'").get()).toBeTruthy();
    db.close();
  });

  it('leaves a fully-migrated legacy database alone', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const insert = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
    for (const v of chainFiles()) insert.run(v);

    expect(runMigrations(db)).toEqual([]);
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
