import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.57 (M42 `gg7sxih6`) — `file_version.operation_id`: the optional id of the
 * multi-file operation that wrote a row, with its own index. Checked on BOTH
 * paths a database can take: fresh (the baseline) and upgraded (061 over rows
 * written before it).
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION = path.join(MIGRATIONS_DIR, '061_file_version_operation_id.sql');

interface ColumnInfo {
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
}

const column = (db: Database.Database, name: string): ColumnInfo | undefined =>
  (db.prepare('PRAGMA table_info(file_version)').all() as ColumnInfo[]).find((c) => c.name === name);

const index = (db: Database.Database, name: string) => {
  const entry = (db.prepare('PRAGMA index_list(file_version)').all() as Array<{ name: string; unique: 0 | 1 }>).find(
    (i) => i.name === name,
  );
  if (!entry) return undefined;
  const columns = (db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>).map((c) => c.name);
  return { unique: entry.unique, columns };
};

/** The schema just before 061: every chain migration up to 060, file by file. */
function dbBefore061(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  for (const file of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && f !== '000_baseline.sql' && f < '061')
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
  }
  return db;
}

describe('file_version.operation_id (2.1.57)', () => {
  it('[entity:file-version] a fresh database has operation_id as a nullable TEXT column without a default, indexed by idx_file_version_operation_id (non-unique)', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(column(db, 'operation_id')).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
    expect(index(db, 'idx_file_version_operation_id')).toEqual({ unique: 0, columns: ['operation_id'] });
    db.close();
  });

  it('[entity:file-version] migration 061 adds the column and its index to an existing table; rows written before it read operation_id = NULL (a single-file write)', () => {
    const db = dbBefore061();
    expect(column(db, 'operation_id')).toBeUndefined();
    db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId)
       VALUES ('a.md', 1, '{}', '1.0.0', 'create', 'user', 'pages')`,
    ).run();

    db.exec(fs.readFileSync(MIGRATION, 'utf-8'));

    expect(column(db, 'operation_id')).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 });
    expect(index(db, 'idx_file_version_operation_id')).toEqual({ unique: 0, columns: ['operation_id'] });
    expect(db.prepare(`SELECT operation_id FROM file_version WHERE path = 'a.md'`).get()).toEqual({ operation_id: null });
    db.close();
  });

  it('[entity:file-version] many rows may share one operation_id — the index is not unique', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const insert = db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId, operation_id)
       VALUES (?, 1, '{}', '1.0.0', 'create', 'user', 'pages', 'op-1')`,
    );
    insert.run('a.md');
    expect(() => insert.run('b.md')).not.toThrow();
    expect(
      (db.prepare(`SELECT path FROM file_version WHERE operation_id = 'op-1' ORDER BY path`).all() as Array<{ path: string }>).map(
        (r) => r.path,
      ),
    ).toEqual(['a.md', 'b.md']);
    db.close();
  });

  it('a fresh database records 061 as applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    );
    expect(versions).toContain('061_file_version_operation_id');
    db.close();
  });
});
