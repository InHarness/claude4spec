/**
 * The generated projection against the v1 plugin's hand-written migrations.
 *
 * This is the de-risking test for the whole port: the claim it makes is that
 * `data.schema` alone reproduces the two tables `backend/migrations.ts` used to
 * create, so nothing about the sheet's storage changed on the way across and an
 * existing database needs no migration of its own.
 *
 * `spreadsheet_cell` is the interesting one, and it is the first table in this
 * repo generated from a KEYED collection — its UNIQUE tuple, its cascade and its
 * binding column exist only because the generator emits them.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { generateProjectionDDL } from '../../../src/server/db/projection.js';
import { spreadsheetData } from '../src/entity/spreadsheet/schema.js';

/** The DDL as the v1 plugin's `backend/migrations.ts` wrote it. */
const RETIRED_DDL = `
  CREATE TABLE IF NOT EXISTS spreadsheet (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    n_rows INTEGER NOT NULL DEFAULT 0,
    n_cols INTEGER NOT NULL DEFAULT 0,
    header_row INTEGER NOT NULL DEFAULT 0,
    header_col INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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

describe('spreadsheet projection', () => {
  it('generates the parent table and the cell table, and nothing else', () => {
    const tables = (
      generatedDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(['spreadsheet', 'spreadsheet_cell']);
  });

  it('keeps v1 cell table NAME rather than taking the host default', () => {
    /**
     * `projectionTable: 'spreadsheet_cell'` is doing real work here. The host
     * would otherwise name it `spreadsheet_cells` from the field, and an
     * existing project's index would have to be dropped and rebuilt under the
     * new name for no reason at all.
     */
    const tables = (
      generatedDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain('spreadsheet_cell');
    expect(tables).not.toContain('spreadsheet_cells');
  });

  it('reproduces v1 parent columns: same names, order, types and defaults', () => {
    const retired = new Database(':memory:');
    retired.exec(RETIRED_DDL);
    const before = columnsOf(retired, 'spreadsheet');
    const after = columnsOf(generatedDb(), 'spreadsheet');

    expect(after.map((c) => c.name)).toEqual(before.map((c) => c.name));
    expect(after.map((c) => c.type)).toEqual(before.map((c) => c.type));
    expect(after.map((c) => c.dflt_value)).toEqual(before.map((c) => c.dflt_value));
    expect(after.map((c) => c.pk)).toEqual(before.map((c) => c.pk));
  });

  it('binds cells to their sheet, and takes them with it on delete', () => {
    const db = generatedDb();
    const fks = db.prepare(`PRAGMA foreign_key_list(spreadsheet_cell)`).all() as Array<{
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
    const uniques = (db.prepare(`PRAGMA index_list(spreadsheet_cell)`).all() as Array<{ name: string; unique: number }>)
      .filter((i) => i.unique === 1)
      .map((i) =>
        (db.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
    expect(uniques).toContainEqual(['spreadsheet_slug', 'r', 'c']);
  });

  it('carries the cell payload column', () => {
    const names = columnsOf(generatedDb(), 'spreadsheet_cell').map((c) => c.name);
    expect(names).toContain('value');
    expect(names).toContain('r');
    expect(names).toContain('c');
  });

  it('enforces the identity it declares', () => {
    const db = generatedDb();
    db.exec(`INSERT INTO spreadsheet (slug, name) VALUES ('s', 'S')`);
    db.exec(`INSERT INTO spreadsheet_cell (spreadsheet_slug, r, c, value) VALUES ('s', 1, 1, 'a')`);
    expect(() =>
      db.exec(`INSERT INTO spreadsheet_cell (spreadsheet_slug, r, c, value) VALUES ('s', 1, 1, 'b')`),
    ).toThrow(/UNIQUE/);
  });
});
