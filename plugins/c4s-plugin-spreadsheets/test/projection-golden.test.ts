/**
 * The generated projection, against v1's hand-written migrations.
 *
 * The claim under test is NOT "the tables are the same" — they are not, and the
 * point of this file is to pin exactly where they differ and why that is safe.
 * v1's cell table binds on `slug`; a keyed collection projects to a table bound
 * on `<parent>_slug`. Those two cannot be the same table, so the port takes a
 * NEW cell table and leaves v1's alone.
 *
 * An earlier version of this file compared against a DDL written from memory
 * (it gave the parent `created_at`/`updated_at`, which v1 never had, and did not
 * mention the cell table at all) and was then cited as evidence that an existing
 * database is adopted unchanged. It was not evidence of anything. Both goldens
 * below are copied verbatim from
 * `c4s-plugin-spreadsheets@0.0.6 src/entity/backend/migrations.ts`.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { generateProjectionDDL } from '../../../src/server/db/projection.js';
import { spreadsheetData } from '../src/entity/spreadsheet/schema.js';
import { LEGACY_SPREADSHEET_CELL_TABLE, SPREADSHEET_CELL_TABLE } from '../src/identity.js';

/**
 * v1 migration 1, verbatim — with the 0.2.22 rename applied.
 *
 * `name` became the reserved `title`; the column moved with the field, and the
 * rest of the table still has to match what the hand-written migration wrote.
 */
const RETIRED_PARENT_DDL = `
  CREATE TABLE IF NOT EXISTS spreadsheet (
    slug        TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL,
    n_rows      INTEGER NOT NULL DEFAULT 0,
    n_cols      INTEGER NOT NULL DEFAULT 0,
    header_row  INTEGER NOT NULL DEFAULT 0,
    header_col  INTEGER NOT NULL DEFAULT 0
  );
`;

/** v1 migration 2, verbatim. Note `slug`, and the composite PRIMARY KEY. */
const RETIRED_CELL_DDL = `
  CREATE TABLE IF NOT EXISTS spreadsheet_cell (
    slug   TEXT    NOT NULL,
    r      INTEGER NOT NULL,
    c      INTEGER NOT NULL,
    value  TEXT    NOT NULL,
    PRIMARY KEY (slug, r, c)
  );
  CREATE INDEX IF NOT EXISTS idx_spreadsheet_cell_slug_r ON spreadsheet_cell (slug, r);
`;

const MODULE = { type: 'spreadsheet', data: spreadsheetData };

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function generatedDb(): Database.Database {
  const db = new Database(':memory:');
  for (const statement of generateProjectionDDL(MODULE)) db.exec(statement);
  return db;
}

const columnsOf = (db: Database.Database, table: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];

const tablesOf = (db: Database.Database) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
    name: string;
  }>).map((r) => r.name);

describe('spreadsheet projection', () => {
  it('generates the parent table and a cell table, and nothing else', () => {
    expect(tablesOf(generatedDb())).toEqual(['spreadsheet', SPREADSHEET_CELL_TABLE]);
  });

  it('does NOT reuse v1’s cell table name', () => {
    /**
     * The single most important assertion in this file.
     *
     * Reusing `spreadsheet_cell` does not adopt v1's table, it collides with it:
     * `CREATE TABLE IF NOT EXISTS` no-ops on the existing table, column
     * reconciliation adds a nullable `spreadsheet_slug` beside v1's NOT NULL
     * `slug`, every read then filters on a column that is NULL in every legacy
     * row, and the first write dies on an `ON CONFLICT` clause matching no
     * constraint — inside the rebuild transaction, so the whole reindex rolls
     * back and the project serves a permanently stale index.
     *
     * Every test in this package builds a FRESH database, so none of them can
     * see that. This one pins the decision that makes it unreachable.
     */
    expect(SPREADSHEET_CELL_TABLE).not.toBe(LEGACY_SPREADSHEET_CELL_TABLE);
    expect(tablesOf(generatedDb())).not.toContain(LEGACY_SPREADSHEET_CELL_TABLE);
  });

  it('v1’s cell table is incompatible with the generated one — the reason for the rename', () => {
    // Stated as a test rather than a comment so that a future change to either
    // side has to confront it.
    const legacy = new Database(':memory:');
    legacy.exec(RETIRED_CELL_DDL);
    const legacyCols = columnsOf(legacy, LEGACY_SPREADSHEET_CELL_TABLE);

    expect(legacyCols.map((c) => c.name)).toContain('slug');
    expect(legacyCols.map((c) => c.name)).not.toContain('spreadsheet_slug');
    // And its identity is a composite PRIMARY KEY, not the UNIQUE the generator emits.
    expect(legacyCols.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(['slug', 'r', 'c']);

    const generatedCols = columnsOf(generatedDb(), SPREADSHEET_CELL_TABLE);
    expect(generatedCols.map((c) => c.name)).toContain('spreadsheet_slug');
    expect(generatedCols.filter((c) => c.pk > 0)).toEqual([]);
  });

  it('reproduces v1’s parent columns, which ARE adopted', () => {
    /**
     * The parent table is the half that carries over: same names, same order,
     * same types, same defaults. The two system-managed timestamps are the only
     * additions, and they are added to an existing database by column
     * reconciliation (nullable, no default, filled by the next index rebuild) —
     * which is the path a new field is designed to take.
     */
    const retired = new Database(':memory:');
    retired.exec(RETIRED_PARENT_DDL);
    const before = columnsOf(retired, 'spreadsheet');
    const after = columnsOf(generatedDb(), 'spreadsheet');

    const v1Names = before.map((c) => c.name);
    expect(after.map((c) => c.name).slice(0, v1Names.length)).toEqual(v1Names);
    expect(after.map((c) => c.name).slice(v1Names.length)).toEqual(['created_at', 'updated_at']);

    for (const [i, col] of before.entries()) {
      expect(after[i]?.type, `${col.name} type`).toBe(col.type);
      expect(after[i]?.dflt_value, `${col.name} default`).toBe(col.dflt_value);
      expect(after[i]?.pk, `${col.name} pk`).toBe(col.pk);
    }
  });

  it('binds cells to their sheet, and takes them with it on delete', () => {
    const db = generatedDb();
    const fks = db.prepare(`PRAGMA foreign_key_list(${SPREADSHEET_CELL_TABLE})`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
      on_update: string;
    }>;
    const binding = fks.find((fk) => fk.table === 'spreadsheet');
    expect(binding).toBeDefined();
    expect(binding?.from).toBe('spreadsheet_slug');
    expect(binding?.to).toBe('slug');
    // Deleting a sheet must not strand its cells; renaming must carry them.
    expect(binding?.on_delete).toBe('CASCADE');
    expect(binding?.on_update).toBe('CASCADE');
  });

  it('makes (sheet, r, c) the cell identity', () => {
    const db = generatedDb();
    const uniques = (
      db.prepare(`PRAGMA index_list(${SPREADSHEET_CELL_TABLE})`).all() as Array<{
        name: string;
        unique: number;
      }>
    )
      .filter((i) => i.unique === 1)
      .map((i) =>
        (db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
    expect(uniques).toContainEqual(['spreadsheet_slug', 'r', 'c']);
  });

  it('carries the cell payload column', () => {
    const names = columnsOf(generatedDb(), SPREADSHEET_CELL_TABLE).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['spreadsheet_slug', 'r', 'c', 'value']));
  });

  it('enforces the identity it declares', () => {
    const db = generatedDb();
    db.exec(`INSERT INTO spreadsheet (slug, title) VALUES ('s', 'S')`);
    db.exec(`INSERT INTO ${SPREADSHEET_CELL_TABLE} (spreadsheet_slug, r, c, value) VALUES ('s', 1, 1, 'a')`);
    expect(() =>
      db.exec(`INSERT INTO ${SPREADSHEET_CELL_TABLE} (spreadsheet_slug, r, c, value) VALUES ('s', 1, 1, 'b')`),
    ).toThrow(/UNIQUE/);
  });
});
