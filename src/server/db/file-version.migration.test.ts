import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.55 (M17) — `file_version` after the release bundle is gone. The window
 * changed no column: `serializer_version` stays (diff fallback across schema
 * bumps), only its cross-project-import purpose left with M27. The table keeps
 * the record's columns and its `(path, rootId, version)` identity.
 */
interface ColumnInfo {
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: number;
}

function migratedDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const columnsOf = (db: Database.Database): Map<string, ColumnInfo> =>
  new Map(
    (db.prepare('PRAGMA table_info(file_version)').all() as ColumnInfo[]).map((c) => [c.name, c]),
  );

describe('file_version schema (2.1.55)', () => {
  it('[entity:file-version] has every column of the record with its type, nullability and default', () => {
    const db = migratedDb();
    const cols = columnsOf(db);
    const shape = (name: string) => {
      const c = cols.get(name);
      return c ? { type: c.type, notnull: c.notnull, dflt: c.dflt_value, pk: c.pk } : null;
    };
    expect(shape('id')).toEqual({ type: 'INTEGER', notnull: 0, dflt: null, pk: 1 });
    expect(shape('path')).toEqual({ type: 'TEXT', notnull: 1, dflt: null, pk: 0 });
    expect(shape('version')).toEqual({ type: 'INTEGER', notnull: 1, dflt: null, pk: 0 });
    expect(shape('data')).toEqual({ type: 'TEXT', notnull: 1, dflt: null, pk: 0 });
    expect(shape('serializer_version')).toEqual({ type: 'TEXT', notnull: 1, dflt: null, pk: 0 });
    expect(shape('op')).toEqual({ type: 'TEXT', notnull: 1, dflt: null, pk: 0 });
    expect(shape('rootId')).toEqual({ type: 'TEXT', notnull: 1, dflt: "'pages'", pk: 0 });
    expect(shape('release_id')).toEqual({ type: 'INTEGER', notnull: 0, dflt: null, pk: 0 });
    expect(shape('changed_by')).toEqual({ type: 'TEXT', notnull: 1, dflt: null, pk: 0 });
    // 2.1.57 — the multi-file operation id (migration 061); NULL = a single-file write.
    expect(shape('operation_id')).toEqual({ type: 'TEXT', notnull: 0, dflt: null, pk: 0 });
    expect(shape('created_at')).toEqual({ type: 'TEXT', notnull: 1, dflt: "datetime('now')", pk: 0 });
    // `INTEGER PRIMARY KEY AUTOINCREMENT` — the table is registered in sqlite_sequence.
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'file_version'").get() as {
      sql: string;
    }).sql;
    expect(sql).toMatch(/id\s+INTEGER PRIMARY KEY AUTOINCREMENT/);
    db.close();
  });

  it('[entity:file-version] the version sequence is unique per (path, rootId, version) — the same path in two roots is two files', () => {
    const db = migratedDb();
    const insert = db.prepare(
      `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId)
       VALUES (?, ?, '{}', '1.0.0', 'create', 'user', ?)`,
    );
    insert.run('a.md', 1, 'pages');
    // Same path and version under another root: a separate timeline, accepted.
    expect(() => insert.run('a.md', 1, 'notes')).not.toThrow();
    // Same (path, rootId, version) twice: refused.
    expect(() => insert.run('a.md', 1, 'pages')).toThrow(/UNIQUE/);
    db.close();
  });
});
