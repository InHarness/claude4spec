import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

/**
 * 2.1.8 — `file_version.rootId` names a root-registry entry: the bare artifact
 * markers `brief`/`patch`/`plan` become the system root ids. One-time and
 * idempotent.
 */
const MIGRATION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
  '057_file_version_root_registry_ids.sql',
);

function dbWithRows(rows: Array<[string, string, number]>): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  const insert = db.prepare(
    `INSERT INTO file_version (path, version, data, serializer_version, op, changed_by, rootId)
     VALUES (?, ?, '{}', '1', 'create', 'filesystem', ?)`,
  );
  for (const [p, rootId, v] of rows) insert.run(p, v, rootId);
  return db;
}

const rootIds = (db: Database.Database): Array<{ path: string; rootId: string }> =>
  db.prepare('SELECT path, rootId FROM file_version ORDER BY id').all() as Array<{ path: string; rootId: string }>;

describe('057 — file_version.rootId remap', () => {
  it('[ac:ac-file-version-z-rootid-brief-po-migracji] a row written with rootId = "brief" has rootId = "briefs" after the migration', () => {
    const db = dbWithRows([
      ['v1.md', 'brief', 1],
      ['p.md', 'patch', 1],
      ['plan.md', 'plan', 1],
      ['index.md', 'pages', 1],
    ]);
    db.exec(fs.readFileSync(MIGRATION, 'utf8'));
    expect(rootIds(db)).toEqual([
      { path: 'v1.md', rootId: 'briefs' },
      { path: 'p.md', rootId: 'patches' },
      { path: 'plan.md', rootId: 'plans' },
      { path: 'index.md', rootId: 'pages' },
    ]);
  });

  it('is idempotent — a second run changes nothing', () => {
    const db = dbWithRows([['v1.md', 'brief', 1]]);
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    db.exec(sql);
    const after = rootIds(db);
    db.exec(sql);
    expect(rootIds(db)).toEqual(after);
  });

  it('a fresh database records the migration as applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    );
    expect(versions).toContain('057_file_version_root_registry_ids');
  });
});
