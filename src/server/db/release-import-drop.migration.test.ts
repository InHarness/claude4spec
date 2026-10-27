import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.55 (M27 removed) — the project-clone audit log `release_import` is dropped
 * with the feature. Nothing referenced it, so the releases it pointed at stay.
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION = '060_drop_release_import.sql';

const tableExists = (db: Database.Database, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

const indexNames = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);

/** A database that replayed the chain up to (not including) 060 — a pre-2.1.55 install. */
function legacyDbBefore060(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql' && f < MIGRATION)
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  return db;
}

describe('060 — release_import dropped', () => {
  it('[entity:release-import] a fresh database has no release_import table and none of its indexes', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(tableExists(db, 'release_import')).toBe(false);
    expect(indexNames(db).filter((n) => n.startsWith('idx_release_import_'))).toEqual([]);
    db.close();
  });

  it('[entity:release-import] an existing database loses release_import (rows and index) after migrating; its releases stay', () => {
    const db = legacyDbBefore060();
    db.prepare(
      `INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1', 'v1', 'first', 'user', '2026-10-01T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO release_import (local_release_id, remote_project_slug, status) VALUES (1, 'some-project', 'success')`,
    ).run();
    expect(tableExists(db, 'release_import')).toBe(true);
    expect(indexNames(db)).toContain('idx_release_import_local_release');

    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));

    expect(tableExists(db, 'release_import')).toBe(false);
    expect(indexNames(db).filter((n) => n.startsWith('idx_release_import_'))).toEqual([]);
    expect(db.prepare('SELECT name FROM spec_release').all()).toEqual([{ name: 'v1' }]);
    db.close();
  });

  it('a fresh database records the migration as applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    );
    expect(versions).toContain('060_drop_release_import');
    db.close();
  });
});
