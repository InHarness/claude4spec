/**
 * A database that already ran the v1 plugin.
 *
 * THIS IS THE CASE THE REST OF THE SUITE CANNOT SEE. Every other test here
 * builds a fresh database, so all of them are green whether or not the port can
 * survive an upgrade — which is exactly how a table-name collision shipped
 * unnoticed. This file starts from v1's own DDL, with v1's own rows in it, and
 * asserts the port neither reads nor writes it.
 *
 * What "correct" means here is narrow and deliberate: the legacy table is
 * derived data with the entity files behind it, so the port does not migrate it
 * and does not drop it. It leaves it alone and builds its own.
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, generateProjectionDDL } from '../../../src/server/db/projection.js';
import { spreadsheetData } from '../src/entity/spreadsheet/schema.js';
import { LEGACY_SPREADSHEET_CELL_TABLE, SPREADSHEET_CELL_TABLE } from '../src/identity.js';

const MODULE = { type: 'spreadsheet', data: spreadsheetData };

/** v1's two migrations plus a sheet and two cells, as a real project would have. */
function v1Database(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS spreadsheet (
      slug        TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      n_rows      INTEGER NOT NULL DEFAULT 0,
      n_cols      INTEGER NOT NULL DEFAULT 0,
      header_row  INTEGER NOT NULL DEFAULT 0,
      header_col  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS spreadsheet_cell (
      slug   TEXT    NOT NULL,
      r      INTEGER NOT NULL,
      c      INTEGER NOT NULL,
      value  TEXT    NOT NULL,
      PRIMARY KEY (slug, r, c)
    );
    INSERT INTO spreadsheet (slug, name, n_rows, n_cols, header_row)
      VALUES ('pliki-external', 'external/', 2, 2, 1);
    INSERT INTO spreadsheet_cell (slug, r, c, value) VALUES ('pliki-external', 1, 1, 'Plik');
    INSERT INTO spreadsheet_cell (slug, r, c, value) VALUES ('pliki-external', 2, 1, 'x');
  `);
  return db;
}

describe('upgrading a database that ran c4s-plugin-spreadsheets 0.0.6', () => {
  it('applies the projection without throwing', () => {
    const db = v1Database();
    expect(() => applyProjection(db, [MODULE] as never)).not.toThrow();
  });

  it('creates its OWN cell table and leaves v1’s untouched', () => {
    const db = v1Database();
    applyProjection(db, [MODULE] as never);

    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain(SPREADSHEET_CELL_TABLE);
    expect(tables).toContain(LEGACY_SPREADSHEET_CELL_TABLE);

    // v1's rows are still there, unread and unharmed. They are derived data with
    // the entity files behind them, so orphaning them loses nothing — but
    // dropping a table of a user's rows on their first boot is not this
    // envelope's call to make silently.
    const legacy = db
      .prepare(`SELECT COUNT(*) AS c FROM ${LEGACY_SPREADSHEET_CELL_TABLE}`)
      .get() as { c: number };
    expect(legacy.c).toBe(2);
  });

  it('does not bolt a binding column onto v1’s table', () => {
    /**
     * The exact shape of the collision that made this file necessary. When the
     * schema pinned `projectionTable: 'spreadsheet_cell'`, column reconciliation
     * added a nullable `spreadsheet_slug` to the LEGACY table — after which every
     * read filtered on a column that was NULL in every existing row.
     */
    const db = v1Database();
    applyProjection(db, [MODULE] as never);
    const legacyCols = (
      db.prepare(`PRAGMA table_info(${LEGACY_SPREADSHEET_CELL_TABLE})`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(legacyCols).toEqual(['slug', 'r', 'c', 'value']);
  });

  it('adopts the parent table, adding the reserved title and the two system timestamps', () => {
    const db = v1Database();
    const result = applyProjection(db, [MODULE] as never);

    // The parent already existed, so it is adopted rather than created.
    expect(result.created).not.toContain('spreadsheet');
    /**
     * `title` joins the timestamps in 0.2.22: an in-place upgrade reconciles the
     * new column onto the existing table rather than needing a migration for it,
     * and the VALUE arrives when the entity files are re-read (the payload
     * upgrade moves `name` into it).
     */
    expect(result.alteredColumns).toEqual([
      'spreadsheet.title',
      'spreadsheet.created_at',
      'spreadsheet.updated_at',
    ]);

    // And the sheet's own data is intact.
    const row = db.prepare(`SELECT name, n_rows FROM spreadsheet WHERE slug = ?`).get('pliki-external') as {
      name: string;
      n_rows: number;
    };
    expect(row).toEqual({ name: 'external/', n_rows: 2 });
  });

  it('a cell write lands in the NEW table, not the legacy one', () => {
    const db = v1Database();
    applyProjection(db, [MODULE] as never);

    // The write the collision used to kill: on the legacy table this threw
    // "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
    expect(() =>
      db.exec(
        `INSERT INTO ${SPREADSHEET_CELL_TABLE} (spreadsheet_slug, r, c, value) VALUES ('pliki-external', 1, 1, 'new')
         ON CONFLICT(spreadsheet_slug, r, c) DO UPDATE SET value = excluded.value`,
      ),
    ).not.toThrow();

    const fresh = db
      .prepare(`SELECT value FROM ${SPREADSHEET_CELL_TABLE} WHERE spreadsheet_slug = ? AND r = 1 AND c = 1`)
      .get('pliki-external') as { value: string };
    expect(fresh.value).toBe('new');
    // The legacy row is untouched by it.
    const old = db
      .prepare(`SELECT value FROM ${LEGACY_SPREADSHEET_CELL_TABLE} WHERE slug = ? AND r = 1 AND c = 1`)
      .get('pliki-external') as { value: string };
    expect(old.value).toBe('Plik');
  });

  it('generating the DDL twice is a no-op on an already-upgraded database', () => {
    const db = v1Database();
    applyProjection(db, [MODULE] as never);
    const second = applyProjection(db, [MODULE] as never);
    expect(second.created).toEqual([]);
    expect(second.alteredColumns).toEqual([]);
    // Sanity: the statements themselves are idempotent.
    expect(() => {
      for (const statement of generateProjectionDDL(MODULE)) db.exec(statement);
    }).not.toThrow();
  });
});
