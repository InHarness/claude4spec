import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.47 (M17 L1 34xy2eei) — `spec_release` gains the accepted-shadow columns
 * `accepted_shadow_id` / `accepted_shadow_sha`: TEXT, nullable, no default —
 * NULL for every release that did not accept a shadow.
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION = '058_spec_release_accepted_shadow.sql';

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

const columns = (db: Database.Database): ColumnInfo[] => db.pragma('table_info(spec_release)') as ColumnInfo[];

/** A database that replayed the chain up to (not including) 058 — a pre-2.1.47 install. */
function legacyDbBefore058(): Database.Database {
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

describe('058 — spec_release accepted-shadow columns', () => {
  it('[entity:spec-release] a fresh database has accepted_shadow_id / accepted_shadow_sha as nullable TEXT with no default', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const byName = new Map(columns(db).map((c) => [c.name, c]));
    for (const name of ['accepted_shadow_id', 'accepted_shadow_sha']) {
      const col = byName.get(name);
      expect(col, name).toBeDefined();
      expect(col!.type).toBe('TEXT');
      expect(col!.notnull).toBe(0);
      expect(col!.dflt_value).toBeNull();
      expect(col!.pk).toBe(0);
    }
    // Every column the record names, in the record's order after the pre-existing ones.
    expect(columns(db).map((c) => c.name)).toEqual([
      'id',
      'name',
      'description',
      'created_by',
      'created_at',
      'slug',
      'roots',
      'accepted_shadow_id',
      'accepted_shadow_sha',
    ]);
    db.close();
  });

  it('[entity:spec-release] an existing database gets both columns, existing rows read NULL in both', () => {
    const db = legacyDbBefore058();
    db.prepare(
      `INSERT INTO spec_release (name, slug, description, created_by, created_at) VALUES ('v1', 'v1', 'first', 'user', '2026-10-01T10:00:00.000Z')`,
    ).run();
    expect(columns(db).map((c) => c.name)).not.toContain('accepted_shadow_id');

    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf-8'));

    const names = columns(db).map((c) => c.name);
    expect(names).toContain('accepted_shadow_id');
    expect(names).toContain('accepted_shadow_sha');
    expect(db.prepare(`SELECT accepted_shadow_id, accepted_shadow_sha FROM spec_release WHERE name = 'v1'`).get()).toEqual({
      accepted_shadow_id: null,
      accepted_shadow_sha: null,
    });
    db.close();
  });

  it('a fresh database records the migration as applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    );
    expect(versions).toContain('058_spec_release_accepted_shadow');
    db.close();
  });
});
