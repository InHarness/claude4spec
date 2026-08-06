/**
 * The write half of the generated projection (0.2.9, brief item 6).
 *
 * `projection.golden.test.ts` pins the DDL a declaration produces. This pins the
 * other direction: that a row written from the same declaration reads back as
 * what went in. The two together are what let a type declare its data and get a
 * working store, so the cases worth having here are the ones where a naive
 * implementation would quietly disagree with `generateProjectionDDL`:
 *
 *   - an absent embedded collection must be `'[]'`, not NULL, because the DDL
 *     says `DEFAULT '[]'` and a reader with two empty cases is a bug waiting;
 *   - a column DEFAULT covers the INSERT but NOT the UPDATE arm of an upsert,
 *     which names every column unconditionally;
 *   - `systemManaged` columns come from the stamp and never from the payload;
 *   - a value collection with `keyFields` REPLACES its projection rows, because
 *     "the collection IS the field".
 */

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection } from './projection.js';
import {
  mutateAxis,
  renameProjectionRow,
  syncProjectionTables,
  upsertProjectionRow,
  writeKeyedWindow,
  type WritableModule,
} from './projection-write.js';
import { DomainError } from '../services/tags.js';

const WRITE_OPTS = { capture: false, writeFile: false };

const widget: WritableModule = {
  type: 'widget',
  payloadVersion: 1,
  data: {
    schema: {
      label: { kind: 'string', required: true },
      size: { kind: 'enum', values: ['s', 'm', 'l'], default: 'm' },
      active: { kind: 'boolean', default: true },
      meta: { kind: 'object', fields: { note: { kind: 'string' } } },
      notes: { kind: 'collection', collection: 'value', item: { kind: 'string' } },
      links: {
        kind: 'collection',
        collection: 'value',
        keyFields: ['target'],
        item: {
          kind: 'object',
          fields: {
            target: { kind: 'string', required: true },
            rank: { kind: 'number' },
          },
        },
      },
      createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
      updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
    },
  },
};

function projected(module: WritableModule = widget): Database.Database {
  const db = new Database(':memory:');
  /**
   * `entity_tag` is a HOST baseline table, not a generated one, so
   * `applyProjection` does not create it — but the write door touches it (a
   * delete cleans an entity's tags, a rename repoints them), because it carries
   * no FK to the entity table and therefore never cascades. A fixture without it
   * is less like production than it looks.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_tag (
      entity_type TEXT NOT NULL,
      entity_slug TEXT NOT NULL,
      tag_slug    TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_slug, tag_slug)
    );
  `);
  applyProjection(db, [module]);
  return db;
}

function row(db: Database.Database, slug = 'w1'): Record<string, unknown> {
  return db.prepare('SELECT * FROM widget WHERE slug = ?').get(slug) as Record<string, unknown>;
}

describe('upsertProjectionRow — round trip through the generated projection', () => {
  it('writes every declared kind in the shape hydrate reads back', () => {
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', {
      label: 'hello',
      size: 'l',
      active: false,
      meta: { note: 'n' },
      notes: ['a', 'b'],
    }, 'user', WRITE_OPTS);

    const r = row(db);
    expect(r.label).toBe('hello');
    expect(r.size).toBe('l');
    // Booleans are 0/1 — SQLite has no boolean storage class.
    expect(r.active).toBe(0);
    // Objects and embedded collections are JSON text, which is what `hydrate`
    // parses back by probing for a leading `{` or `[`.
    expect(JSON.parse(r.meta as string)).toEqual({ note: 'n' });
    expect(JSON.parse(r.notes as string)).toEqual(['a', 'b']);
  });

  it('fills a declared default rather than NULL when the payload omits the field', () => {
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    const r = row(db);
    expect(r.size).toBe('m');
    expect(r.active).toBe(1);
  });

  it('stores an absent embedded collection as [] — never NULL', () => {
    // The DDL says `DEFAULT '[]'` for exactly this reason. A NULL here would give
    // every reader two different empty cases to handle.
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    expect(row(db).notes).toBe('[]');
  });

  it('applies defaults on the UPDATE arm too, where the column DEFAULT cannot reach', () => {
    // The trap this pins: a column DEFAULT fires on INSERT only. The upsert's
    // UPDATE arm names every column, so a field dropped from the payload on the
    // second write would carry the FIRST write's value forward if the code
    // trusted the DDL to fill it.
    const db = projected();
    const deps = { db, versions: null };
    upsertProjectionRow(deps, widget, 'w1', { label: 'x', size: 'l', notes: ['a'] }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);

    const r = row(db);
    expect(r.size).toBe('m');
    expect(r.notes).toBe('[]');
  });

  it('reports created then updated for the same slug', () => {
    const db = projected();
    const deps = { db, versions: null };
    expect(upsertProjectionRow(deps, widget, 'w1', { label: 'a' }, 'user', WRITE_OPTS).op).toBe('created');
    expect(upsertProjectionRow(deps, widget, 'w1', { label: 'b' }, 'user', WRITE_OPTS).op).toBe('updated');
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 1 });
  });
});

describe('upsertProjectionRow — system fields belong to the host', () => {
  it('writes the audit columns from the stamp, ignoring any payload value', () => {
    const db = projected();
    const stamp = { createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-02T00:00:00.000Z' };
    upsertProjectionRow({ db, versions: null }, widget, 'w1', {
      label: 'x',
      createdAt: '1999-12-31T00:00:00.000Z',
      updatedAt: '1999-12-31T00:00:00.000Z',
    }, 'user', { ...WRITE_OPTS, stamp });

    const r = row(db);
    expect(r.created_at).toBe(stamp.createdAt);
    expect(r.updated_at).toBe(stamp.updatedAt);
  });

  it('writes a type that declares NO audit columns at all', () => {
    // The six built-ins all opt into `systemManaged` timestamps, but the flag is
    // an opt-in. Probing for `created_at` unconditionally would turn a leaner
    // declaration into a `no such column` write failure.
    const bare: WritableModule = {
      type: 'widget',
      payloadVersion: 1,
      data: { schema: { label: { kind: 'string', required: true } } },
    };
    const db = projected(bare);
    expect(() =>
      upsertProjectionRow({ db, versions: null }, bare, 'w1', { label: 'x' }, 'user', WRITE_OPTS),
    ).not.toThrow();
    expect(row(db).label).toBe('x');
  });
});

describe('upsertProjectionRow — the declaration is enforced, not advisory', () => {
  it('rejects a missing required field instead of writing a broken row', () => {
    const db = projected();
    expect(() =>
      upsertProjectionRow({ db, versions: null }, widget, 'w1', {}, 'user', WRITE_OPTS),
    ).toThrow(DomainError);
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });

  it('rejects an out-of-range enum rather than coercing it', () => {
    // The retired per-type code mapped an unknown `diagram.format` onto
    // `mermaid` silently, turning a typo into a wrong diagram that rendered
    // fine. A declared enum exists to make that impossible.
    const db = projected();
    expect(() =>
      upsertProjectionRow({ db, versions: null }, widget, 'w1', { label: 'x', size: 'xl' }, 'user', WRITE_OPTS),
    ).toThrow(/expected one of s, m, l/);
  });

});

/**
 * Keyed collections (tier C, items 19–23).
 *
 * The cases below are the ones where the keyed rules differ from the value
 * rules, which is the whole reason the two paths are separate functions: a
 * value collection replaces wholesale and stores whatever it is handed, a keyed
 * one reconciles per key and refuses to store an empty item at all.
 */
describe('keyed collections', () => {
  const grid: WritableModule = {
    type: 'grid',
    payloadVersion: 1,
    data: {
      schema: {
        name: { kind: 'string', required: true },
        nRows: { kind: 'number', column: 'n_rows', default: 0 },
        nCols: { kind: 'number', column: 'n_cols', default: 0 },
        cells: {
          kind: 'collection',
          collection: 'keyed',
          keyFields: ['r', 'c'],
          axes: [
            { key: 'r', extent: 'nRows' },
            { key: 'c', extent: 'nCols' },
          ],
          item: {
            kind: 'object',
            fields: {
              r: { kind: 'number', required: true },
              c: { kind: 'number', required: true },
              value: { kind: 'string' },
            },
          },
        },
        updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
      },
    },
  };

  const cell = (r: number, c: number, value: string) => ({ r, c, value });

  function seeded(cells = [cell(1, 1, 'a'), cell(2, 2, 'b')]): Database.Database {
    const db = projected(grid);
    upsertProjectionRow(
      { db, versions: null },
      grid,
      'g1',
      { name: 'g', nRows: 3, nCols: 3, cells },
      'user',
      WRITE_OPTS,
    );
    return db;
  }

  const cellsOf = (db: Database.Database) =>
    db.prepare('SELECT r, c, value FROM grid_cells ORDER BY r, c').all();

  it('reconciles per key: absent keys go, present keys land', () => {
    const db = seeded();
    // Replace-all: (1,1) survives because it is in the dump, (2,2) goes because
    // it is not, (3,3) arrives. A value-collection write would have produced the
    // same final rows here by deleting everything first — the difference this
    // asserts is the RESULT, and the sparse cases below are where they diverge.
    syncProjectionTables(db, grid, 'g1', { cells: [cell(1, 1, 'a2'), cell(3, 3, 'c')] });
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a2' },
      { r: 3, c: 3, value: 'c' },
    ]);
  });

  it('never stores an empty item, and writing one deletes its key', () => {
    // Sparse discipline (item 19): the four sentences in the brief — not stored,
    // writing empty deletes, rebuild skips, snapshot omits — are one rule.
    const db = seeded();
    syncProjectionTables(db, grid, 'g1', {
      cells: [cell(1, 1, ''), cell(2, 2, 'b'), cell(3, 3, '')],
    });
    expect(cellsOf(db)).toEqual([{ r: 2, c: 2, value: 'b' }]);
  });

  it('treats 0 and false as content, not as empty', () => {
    // `''` is empty; a falsy VALUE is not. Deleting a cell holding `0` would
    // lose authored content on every rebuild.
    const numeric: WritableModule = {
      ...grid,
      data: {
        schema: {
          ...grid.data!.schema,
          cells: {
            ...(grid.data!.schema.cells as never as Record<string, unknown>),
            item: {
              kind: 'object',
              fields: {
                r: { kind: 'number', required: true },
                c: { kind: 'number', required: true },
                value: { kind: 'number' },
              },
            },
          } as never,
        },
      },
    };
    const db = projected(numeric);
    upsertProjectionRow(
      { db, versions: null },
      numeric,
      'g1',
      { name: 'g', nRows: 1, nCols: 1, cells: [{ r: 1, c: 1, value: 0 }] },
      'user',
      WRITE_OPTS,
    );
    expect(db.prepare('SELECT value FROM grid_cells').all()).toEqual([{ value: 0 }]);
  });

  it('a windowed write MERGES — it does not disturb keys it did not name', () => {
    // The difference from reconcile, and the reason they are two functions.
    const db = seeded();
    writeKeyedWindow({ db, versions: null }, grid, 'g1', 'cells', [cell(3, 3, 'c')], 'user', WRITE_OPTS);
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
      { r: 3, c: 3, value: 'c' },
    ]);
  });

  it('a windowed write stamps the PARENT updatedAt (item 21)', () => {
    const db = seeded();
    db.prepare(`UPDATE grid SET updated_at = '2000-01-01T00:00:00.000Z' WHERE slug = 'g1'`).run();
    writeKeyedWindow({ db, versions: null }, grid, 'g1', 'cells', [cell(1, 2, 'x')], 'user', WRITE_OPTS);
    const row = db.prepare(`SELECT updated_at FROM grid WHERE slug = 'g1'`).get() as {
      updated_at: string;
    };
    expect(row.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('captures exactly ONE entity_version per call, whatever the key count (item 22)', () => {
    // The trigger is the operation closing — explicitly not a time window and
    // not a batch size, both of which the brief rejects as non-deterministic.
    const db = projected(grid);
    const captureEntitySnapshot = vi.fn();
    const deps = { db, versions: { captureEntitySnapshot } };
    upsertProjectionRow(deps, grid, 'g1', { name: 'g', nRows: 20, nCols: 20 }, 'user', {
      capture: false,
      writeFile: false,
    });

    const hundred = Array.from({ length: 100 }, (_, i) =>
      cell(Math.floor(i / 10) + 1, (i % 10) + 1, `v${i}`),
    );
    writeKeyedWindow(deps, grid, 'g1', 'cells', hundred, 'user', { capture: true, writeFile: false });

    expect(captureEntitySnapshot).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM grid_cells').get()).toEqual({ c: 100 });
  });

  it('an axis insert shifts every coordinate past it and grows the extent (item 20)', () => {
    // Keys are not a stable identity: the cell that was at row 2 is at row 3
    // afterwards, which is why M39 forbids caching keys across this call.
    const db = seeded([cell(1, 1, 'a'), cell(2, 1, 'b'), cell(3, 1, 'c')]);
    const { extent } = mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'r', 'insert', 2, 'user', WRITE_OPTS);
    expect(extent).toBe(4);
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 3, c: 1, value: 'b' },
      { r: 4, c: 1, value: 'c' },
    ]);
    expect(db.prepare(`SELECT n_rows FROM grid WHERE slug = 'g1'`).get()).toEqual({ n_rows: 4 });
  });

  it('an axis insert survives a DENSE axis — the shift cannot self-collide', () => {
    // `UNIQUE(binding, row, col)` is checked per row as SQLite applies an
    // UPDATE, so a naive `SET row = row + 1` collides on adjacent occupied
    // positions, and `ORDER BY … DESC` is unavailable in this build.
    const db = seeded([cell(1, 1, 'a'), cell(2, 1, 'b'), cell(3, 1, 'c'), cell(4, 1, 'd')]);
    expect(() =>
      mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'r', 'insert', 1, 'user', WRITE_OPTS),
    ).not.toThrow();
    expect(cellsOf(db).map((r) => (r as { r: number }).r)).toEqual([2, 3, 4, 5]);
  });

  it('an axis delete drops that position and pulls the rest back', () => {
    const db = seeded([cell(1, 1, 'a'), cell(2, 1, 'b'), cell(3, 1, 'c')]);
    const { extent } = mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'r', 'delete', 2, 'user', WRITE_OPTS);
    expect(extent).toBe(2);
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 1, value: 'c' },
    ]);
  });

  it('a parent rename repoints the whole collection in the same operation (item 23)', () => {
    // The binding column carries ON UPDATE CASCADE, so this holds as long as the
    // rename is an in-place UPDATE of the parent slug. Insert-then-delete would
    // leave the new row with an empty collection and then cascade the old rows
    // away — a rename that silently empties a grid of any size.
    const db = seeded();
    db.pragma('foreign_keys = ON');
    renameProjectionRow({ db, versions: null }, grid, 'g1', 'g2', 'user', WRITE_OPTS);

    expect(db.prepare(`SELECT slug FROM grid`).all()).toEqual([{ slug: 'g2' }]);
    expect(db.prepare('SELECT grid_slug FROM grid_cells GROUP BY grid_slug').all()).toEqual([
      { grid_slug: 'g2' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM grid_cells').get()).toEqual({ c: 2 });
  });

  it('a rename touches NOTHING but the slug', () => {
    // The bug this replaces: the rename used to ride on `upsertProjectionRow`,
    // which names every declared column, so a `{ name, newSlug }` payload reset
    // `nRows`/`nCols` to their defaults. The cells survived and the grid
    // reported itself as 0x0 — every window came back empty over a full table.
    const db = seeded();
    renameProjectionRow({ db, versions: null }, grid, 'g1', 'g2', 'user', WRITE_OPTS);
    expect(db.prepare(`SELECT name, n_rows, n_cols FROM grid WHERE slug = 'g2'`).get()).toEqual({
      name: 'g',
      n_rows: 3,
      n_cols: 3,
    });
  });

  it('the full-replace door REFUSES a rename rather than half-doing one', () => {
    // Silently ignoring `newSlug` would leave the caller with an un-renamed
    // entity and no error, which is the failure this refusal replaces.
    const db = seeded();
    expect(() =>
      upsertProjectionRow({ db, versions: null }, grid, 'g1', { name: 'g', newSlug: 'g2' }, 'user', WRITE_OPTS),
    ).toThrow(/cannot carry a rename/);
  });

  it('refuses a rename onto an occupied slug', () => {
    const db = seeded();
    upsertProjectionRow({ db, versions: null }, grid, 'g2', { name: 'other' }, 'user', WRITE_OPTS);
    expect(() =>
      renameProjectionRow({ db, versions: null }, grid, 'g1', 'g2', 'user', WRITE_OPTS),
    ).toThrow(/slug 'g2' already exists/);
  });

  it('reports a declared-fk block as a conflict, not as a 500', () => {
    // A declared `fk` is emitted without ON UPDATE CASCADE, so the rename raises
    // a bare SqliteError that the HTTP layer would report as 500 INTERNAL. It is
    // a refusal, and has to read as one.
    const db = seeded();
    db.exec(`
      CREATE TABLE widget (
        slug TEXT NOT NULL PRIMARY KEY,
        grid_slug TEXT,
        FOREIGN KEY (grid_slug) REFERENCES grid(slug)
      );
      INSERT INTO widget (slug, grid_slug) VALUES ('w1', 'g1');
    `);
    db.pragma('foreign_keys = ON');
    expect(() =>
      renameProjectionRow({ db, versions: null }, grid, 'g1', 'g2', 'user', WRITE_OPTS),
    ).toThrow(/references it through a declared foreign key/);
    // And the rename rolled back rather than half-applying.
    expect(db.prepare(`SELECT slug FROM grid`).all()).toEqual([{ slug: 'g1' }]);
  });

  it('refuses a PRESENT but non-array keyed payload instead of emptying it', () => {
    // `cells: null` in a file used to mean "delete every cell", and the next
    // persist wrote the emptied grid back into the source of truth — a whole
    // spreadsheet lost by a rebuild that reported success.
    const db = seeded();
    expect(() => syncProjectionTables(db, grid, 'g1', { cells: null })).toThrow(
      /must be a list of items/,
    );
    expect(db.prepare('SELECT COUNT(*) AS c FROM grid_cells').get()).toEqual({ c: 2 });
  });

  it('refuses a coordinate that is not a positive integer', () => {
    // `mutateAxis` parks shifted rows on NEGATIVE coordinates, which is only
    // collision-free while no real row is negative. One stored `r: -1` made
    // every later axis operation on that entity fail permanently, with no way
    // to address the offending cell through a 1-based window.
    const db = seeded();
    const warnings = syncProjectionTables(db, grid, 'g1', {
      cells: [cell(1, 1, 'a'), cell(-1, 1, 'bad'), cell(0, 2, 'also bad')],
    });
    expect(warnings.join(' ')).toMatch(/unusable key/);
    expect(db.prepare('SELECT COUNT(*) AS c FROM grid_cells WHERE r < 1').get()).toEqual({ c: 0 });
  });

  it('normalizes a numeric-string coordinate instead of deleting the cell', () => {
    // The reconcile pass compared RAW payload keys against DECODED column keys,
    // so `"1"` did not match stored `1` and the delete pass removed a cell the
    // dump plainly still contained.
    const db = seeded();
    syncProjectionTables(db, grid, 'g1', {
      cells: [{ r: '1', c: '1', value: 'a' }, { r: '2', c: '2', value: 'b' }],
    });
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
    ]);
  });

  it('keeps the FIRST of duplicate entries and warns, like the value path', () => {
    // Last-wins let a duplicated line whose second copy is empty delete the
    // content the first copy wrote, with nothing logged.
    const db = seeded();
    const warnings = syncProjectionTables(db, grid, 'g1', {
      cells: [cell(1, 1, 'a'), cell(1, 1, '')],
    });
    expect(warnings.join(' ')).toMatch(/more than once — kept the first/);
    expect(cellsOf(db)).toEqual([{ r: 1, c: 1, value: 'a' }]);
  });

  /** A grid whose cell carries TWO payload fields — where merge granularity shows. */
  const twoField: WritableModule = {
    ...grid,
    data: {
      schema: {
        ...grid.data!.schema,
        cells: {
          kind: 'collection',
          collection: 'keyed',
          keyFields: ['r', 'c'],
          axes: [
            { key: 'r', extent: 'nRows' },
            { key: 'c', extent: 'nCols' },
          ],
          item: {
            kind: 'object',
            fields: {
              r: { kind: 'number', required: true },
              c: { kind: 'number', required: true },
              value: { kind: 'string' },
              note: { kind: 'string' },
            },
          },
        },
      },
    },
  };

  function seededTwoField(): Database.Database {
    const db = projected(twoField);
    upsertProjectionRow(
      { db, versions: null },
      twoField,
      'g1',
      { name: 'g', nRows: 2, nCols: 2, cells: [{ r: 1, c: 1, value: 'v', note: 'keep me' }] },
      'user',
      WRITE_OPTS,
    );
    return db;
  }

  it('a windowed write merges at FIELD granularity, not just at key granularity', () => {
    // Naming every column and binding absentValue for the omitted ones meant
    // updating a cell's `value` silently nulled its `note`.
    const db = projected(twoField);
    upsertProjectionRow(
      { db, versions: null },
      twoField,
      'g1',
      { name: 'g', nRows: 2, nCols: 2, cells: [{ r: 1, c: 1, value: 'v', note: 'keep me' }] },
      'user',
      WRITE_OPTS,
    );

    writeKeyedWindow(
      { db, versions: null },
      twoField,
      'g1',
      'cells',
      [{ r: 1, c: 1, value: 'v2' }],
      'user',
      WRITE_OPTS,
    );

    expect(db.prepare('SELECT value, note FROM grid_cells').get()).toEqual({
      value: 'v2',
      note: 'keep me',
    });
  });

  it('clearing ONE field of a cell does not delete the fields it did not name', () => {
    // Emptiness has to be judged on the MERGED item, or the delete disagrees
    // with the upsert directly above it: `{r, c, value: ''}` omits `note`, the
    // omission read as empty, and the whole row went — taking a note the caller
    // never mentioned. The upsert half has merged at field granularity since it
    // was written; this is the delete half finally agreeing with it.
    const db = seededTwoField();
    writeKeyedWindow({ db, versions: null }, twoField, 'g1', 'cells', [{ r: 1, c: 1, value: '' }], 'user', WRITE_OPTS);

    expect(db.prepare('SELECT value, note FROM grid_cells').get()).toEqual({ value: '', note: 'keep me' });
  });

  it('clearing the LAST field with content deletes the key, sparse discipline intact', () => {
    const db = seededTwoField();
    writeKeyedWindow({ db, versions: null }, twoField, 'g1', 'cells', [{ r: 1, c: 1, note: '' }], 'user', WRITE_OPTS);
    // `value` still holds 'v', so the item is not empty and the key survives.
    expect(db.prepare('SELECT value, note FROM grid_cells').get()).toEqual({ value: 'v', note: '' });

    writeKeyedWindow({ db, versions: null }, twoField, 'g1', 'cells', [{ r: 1, c: 1, value: '' }], 'user', WRITE_OPTS);
    expect(db.prepare('SELECT COUNT(*) AS c FROM grid_cells').get()).toEqual({ c: 0 });
  });

  it('an entry carrying no payload field at all is still a plain deletion', () => {
    // "Remove this key" needs a spelling that does not require naming every
    // field of a wide item.
    const db = seededTwoField();
    writeKeyedWindow({ db, versions: null }, twoField, 'g1', 'cells', [{ r: 1, c: 1 }], 'user', WRITE_OPTS);
    expect(db.prepare('SELECT COUNT(*) AS c FROM grid_cells').get()).toEqual({ c: 0 });
  });

  it('refuses a coordinate past the declared extent, where no window could reach it', () => {
    // `overview` reports the grid from the parent's extent columns and never
    // from MAX(coordinate), so a cell written outside them is invisible — and
    // `mutateAxis` refuses a position past the extent, so it cannot be deleted
    // by the operation that would otherwise shift it.
    const db = seeded();
    expect(() =>
      writeKeyedWindow({ db, versions: null }, grid, 'g1', 'cells', [cell(9, 1, 'far')], 'user', WRITE_OPTS),
    ).toThrow(/past the declared extent/);
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
    ]);
  });

  it('rolls the whole window back when one entry is rejected', () => {
    // The reconcile door degrades a bad entry to a warning because throwing on
    // the restore path empties the collection. This door has a live caller, so
    // a rejected entry is an error, not a note attached to a success.
    const db = seeded();
    expect(() =>
      writeKeyedWindow(
        { db, versions: null },
        grid,
        'g1',
        'cells',
        [cell(3, 3, 'good'), { r: 0, c: 1, value: 'unusable key' }],
        'user',
        WRITE_OPTS,
      ),
    ).toThrow(/write rejected/);
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
    ]);
  });

  it('refuses an axis op outside the vocabulary', () => {
    // `'remove'` took the insert arm while computing the delete extent.
    const db = seeded([cell(1, 1, 'a'), cell(2, 1, 'b')]);
    expect(() =>
      mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'r', 'remove' as never, 2, 'user', WRITE_OPTS),
    ).toThrow(/must be 'insert' or 'delete'/);
    expect(cellsOf(db)).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 1, value: 'b' },
    ]);
    expect(db.prepare(`SELECT n_rows FROM grid WHERE slug = 'g1'`).get()).toEqual({ n_rows: 3 });
  });

  it('refuses an axis position past the current extent', () => {
    // A delete at 99 of a 3-row grid removed nothing and shifted nothing, yet
    // still wrote extent = 2 — pushing the last row's cells outside the
    // reported dimensions, where no window could reach them again.
    const db = seeded([cell(1, 1, 'a'), cell(3, 1, 'c')]);
    expect(() =>
      mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'r', 'delete', 99, 'user', WRITE_OPTS),
    ).toThrow(/highest delete position is 3/);
    expect(db.prepare(`SELECT n_rows FROM grid WHERE slug = 'g1'`).get()).toEqual({ n_rows: 3 });

    // Insert may append one past the end; delete may not.
    expect(() =>
      mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'r', 'insert', 4, 'user', WRITE_OPTS),
    ).not.toThrow();
  });

  it('refuses a write to a field that is not a keyed collection', () => {
    const db = seeded();
    expect(() =>
      writeKeyedWindow({ db, versions: null }, grid, 'g1', 'name', [], 'user', WRITE_OPTS),
    ).toThrow(/not a keyed collection/);
  });

  it('refuses an axis the declaration does not name', () => {
    const db = seeded();
    expect(() =>
      mutateAxis({ db, versions: null }, grid, 'g1', 'cells', 'depth', 'insert', 1, 'user', WRITE_OPTS),
    ).toThrow(/no axis 'depth'/);
  });
});

describe('upsertProjectionRow — projection tables', () => {
  const links = (db: Database.Database): unknown[] =>
    db.prepare('SELECT target, rank FROM widget_links ORDER BY target').all();

  it('writes a value collection that has its own table', () => {
    const db = projected();
    upsertProjectionRow({ db, versions: null }, widget, 'w1', {
      label: 'x',
      links: [{ target: 'b', rank: 2 }, { target: 'a', rank: 1 }],
    }, 'user', WRITE_OPTS);

    expect(links(db)).toEqual([
      { target: 'a', rank: 1 },
      { target: 'b', rank: 2 },
    ]);
  });

  it('REPLACES the rows wholesale on rewrite — the collection IS the field', () => {
    const db = projected();
    const deps = { db, versions: null };
    upsertProjectionRow(deps, widget, 'w1', {
      label: 'x',
      links: [{ target: 'a', rank: 1 }, { target: 'b', rank: 2 }],
    }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, widget, 'w1', {
      label: 'x',
      links: [{ target: 'c', rank: 3 }],
    }, 'user', WRITE_OPTS);

    expect(links(db)).toEqual([{ target: 'c', rank: 3 }]);
  });

  it('clears the rows when the collection is omitted entirely', () => {
    // For a value collection, "the payload said nothing" and "the collection is
    // empty" are the same statement — the field IS the collection.
    const db = projected();
    const deps = { db, versions: null };
    upsertProjectionRow(deps, widget, 'w1', { label: 'x', links: [{ target: 'a' }] }, 'user', WRITE_OPTS);
    upsertProjectionRow(deps, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    expect(links(db)).toEqual([]);
  });
});

describe('upsertProjectionRow — version capture', () => {
  it('captures through the same door every other write path uses', () => {
    const captureEntitySnapshot = vi.fn();
    const db = projected();
    upsertProjectionRow(
      { db, versions: { captureEntitySnapshot } },
      { ...widget, payloadVersion: 2 },
      'w1', { label: 'x' }, 'user',
      { capture: true, writeFile: false },
    );
    // 0.2.9 (item 13): the door passes NO version at all. Which version a
    // capture carries is the version service's answer, resolved once from the
    // manifest — a writer that supplied its own was a writer free to disagree
    // with the other seventeen call sites.
    expect(captureEntitySnapshot).toHaveBeenCalledWith('widget', 'w1', 'create', 'user', 'Created');
  });

  it('rolls the row back when the capture throws', () => {
    // Every service captures INSIDE its transaction, and `captureEntitySnapshot`
    // rethrows precisely "so the caller's transaction rolls back and the failure
    // surfaces". Capturing after the commit left a committed row with no version
    // row attributing it — invisible to history and to the next release diff.
    const db = projected();
    const captureEntitySnapshot = vi.fn(() => { throw new Error('capture exploded'); });
    expect(() =>
      upsertProjectionRow({ db, versions: { captureEntitySnapshot } }, widget, 'w1', { label: 'x' }, 'user', {
        capture: true, writeFile: false,
      }),
    ).toThrow(/capture exploded/);
    expect(db.prepare('SELECT COUNT(*) AS c FROM widget').get()).toEqual({ c: 0 });
  });

  it('captures nothing on the rebuild path', () => {
    // `indexAll()` reconstructs the index from files it already trusts. A capture
    // there would mint a version row per entity on every boot.
    const captureEntitySnapshot = vi.fn();
    const db = projected();
    upsertProjectionRow({ db, versions: { captureEntitySnapshot } }, widget, 'w1', { label: 'x' }, 'user', WRITE_OPTS);
    expect(captureEntitySnapshot).not.toHaveBeenCalled();
  });
});

/**
 * What the generic junction door has to keep doing that the per-type
 * `syncEndpointDtos` used to.
 *
 * Deleting the per-type restore hooks moved junction writing here, and a review
 * found the move had carried the ROWS across but not the behaviour around them:
 * the dedup, the enum validation, and the tolerance for a constraint the checks
 * did not anticipate. Each omission turns a bad row into a lost collection,
 * because the indexer degrades a throwing restore into a silent skip.
 */
describe('the generic junction door keeps the per-type guarantees', () => {
  const linky: WritableModule = {
    type: 'widget',
    payloadVersion: 1,
    data: {
      schema: {
        label: { kind: 'string', required: true },
        links: {
          kind: 'collection',
          collection: 'value',
          projectionTable: 'widget_link',
          keyFields: ['target', 'relation'],
          item: {
            kind: 'object',
            fields: {
              target: { kind: 'string', column: 'target_slug', required: true },
              relation: { kind: 'enum', values: ['request', 'response'], required: true },
              statusCode: { kind: 'number', column: 'status_code' },
            },
          },
        },
        createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
        updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
      },
    },
  };

  const rows = (db: Database.Database) =>
    db.prepare(`SELECT target_slug, relation, status_code FROM widget_link WHERE widget_slug = 'w1'`).all();

  /** The junction binds to a real parent row, so one has to exist. */
  function seeded(): Database.Database {
    const db = projected(linky);
    upsertProjectionRow({ db, versions: null }, linky, 'w1', { label: 'w' }, 'user', WRITE_OPTS);
    return db;
  }

  it('collapses a duplicate rather than dying on the UNIQUE constraint', () => {
    // The removed `syncEndpointDtos` keyed a Map by exactly this tuple, so a
    // payload naming the same link twice collapsed. A plain INSERT per item threw
    // instead — and a throw here aborts the entity, so one duplicated line in a
    // hand-edited file (or a git merge of two branches that each added the link)
    // left the endpoint with ZERO links instead of the deduplicated set.
    const db = seeded();
    const warnings = syncProjectionTables(db, linky, 'w1', {
      links: [
        { target: 'a', relation: 'response', statusCode: 200 },
        { target: 'a', relation: 'response', statusCode: 200 },
      ],
    });
    expect(rows(db)).toHaveLength(1);
    expect(warnings.join()).toMatch(/more than once/);
  });

  it('rejects an item whose enum value is not declared, instead of storing it', () => {
    // `upsertProjectionRow`'s enum sweep only walks the PARENT row's fields, so
    // until this check a misspelled `relation` landed in the table verbatim,
    // rendered on the detail page, and was written back into the file as real.
    const db = seeded();
    const warnings = syncProjectionTables(db, linky, 'w1', {
      links: [
        { target: 'a', relation: 'resposne' },
        { target: 'b', relation: 'response' },
      ],
    });
    expect(rows(db)).toEqual([{ target_slug: 'b', relation: 'response', status_code: null }]);
    expect(warnings.join()).toMatch(/expected one of request, response/);
    // The GOOD row still landed — one bad item must not cost the collection.
    expect(rows(db)).toHaveLength(1);
  });
});
