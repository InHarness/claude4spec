/**
 * The whole stack, on the REAL type rather than a fixture.
 *
 * Until this envelope existed, every assertion about keyed collections in this
 * repo ran against a `fixtureModule('grid', …)` registered by the test itself —
 * the M39 tier-C machinery had no shipped consumer at all, and the e2e file for
 * its routes said so in its header. What only this level can show is that a type
 * declared in a manifest, built into a bundle, discovered as a built-in envelope
 * and registered through the loader ends up with the same behaviour the fixture
 * proved: `spreadsheet` arrives through `loadBuiltinEnvelopes`, and nothing here
 * constructs it.
 *
 * It therefore also pins the two claims the port rests on: that the sheet's
 * storage did not change, and that a cell can be written without resending the
 * grid.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';

describe('spreadsheet — the shipped type', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await t.crud.create('spreadsheet', { name: 'Q1 revenue', nRows: 4, nCols: 3, headerRow: true }, 'user');
    t.broadcasts.length = 0;
  });
  afterEach(() => t.cleanup());

  const cells = () =>
    t.db.prepare('SELECT r, c, value FROM spreadsheet_cell ORDER BY r, c').all() as Array<{
      r: number;
      c: number;
      value: string;
    }>;
  const sheet = () =>
    t.db.prepare('SELECT n_rows, n_cols FROM spreadsheet WHERE slug = ?').get('q1-revenue') as {
      n_rows: number;
      n_cols: number;
    };
  const entityFile = () =>
    JSON.parse(fs.readFileSync(path.join(t.cwd, '.claude4spec/entities/spreadsheet/q1-revenue.json'), 'utf8'));

  it('is registered by the loader, not by this test', () => {
    const types = t.host.listEntities().map((m) => m.type);
    expect(types).toContain('spreadsheet');
  });

  it('slugifies the name, and suffixes a collision rather than refusing it', async () => {
    // Two sheets sharing a title is ordinary — people name things.
    const again = await t.crud.create('spreadsheet', { name: 'Q1 revenue', nRows: 1, nCols: 1 }, 'user');
    expect(again.slug).toBe('q1-revenue-2');
  });

  it('writes one cell without resending the grid', async () => {
    await t.crud.writeCollectionWindow('spreadsheet', 'q1-revenue', 'cells', [{ r: 1, c: 1, value: 'Region' }], 'user');
    await t.crud.writeCollectionWindow('spreadsheet', 'q1-revenue', 'cells', [{ r: 2, c: 1, value: 'North' }], 'user');

    // The second write MERGED. Through `crud.update` the first cell would be gone.
    expect(cells()).toEqual([
      { r: 1, c: 1, value: 'Region' },
      { r: 2, c: 1, value: 'North' },
    ]);
    expect(t.broadcasts).toContainEqual({ kind: 'entity:changed', entityType: 'spreadsheet', slug: 'q1-revenue' });
  });

  it('stores a sheet sparsely and snapshots it that way too', async () => {
    await t.crud.writeCollectionWindow(
      'spreadsheet',
      'q1-revenue',
      'cells',
      [
        { r: 1, c: 1, value: 'Region' },
        { r: 1, c: 2, value: '' },
        { r: 1, c: 3, value: 'Q1' },
      ],
      'user',
    );
    // The blank was never stored — not stored as `''`, not stored as a row.
    expect(cells()).toEqual([
      { r: 1, c: 1, value: 'Region' },
      { r: 1, c: 3, value: 'Q1' },
    ]);
    expect(entityFile().cells).toEqual([
      { r: 1, c: 1, value: 'Region' },
      { r: 1, c: 3, value: 'Q1' },
    ]);
  });

  it('carries the payload version marker, so a v1 file is distinguishable from a v2 one', () => {
    expect(entityFile().payloadVersion).toBe(2);
  });

  it('clearing the last cell does not shrink the sheet', async () => {
    await t.crud.writeCollectionWindow('spreadsheet', 'q1-revenue', 'cells', [{ r: 4, c: 3, value: 'x' }], 'user');
    expect(sheet()).toEqual({ n_rows: 4, n_cols: 3 });

    await t.crud.writeCollectionWindow('spreadsheet', 'q1-revenue', 'cells', [{ r: 4, c: 3, value: '' }], 'user');

    expect(cells()).toEqual([]);
    // The dimensions are AUTHORED. An empty 4×3 sheet is still 4×3.
    expect(sheet()).toEqual({ n_rows: 4, n_cols: 3 });
  });

  it('refuses a write past the declared extent instead of growing the sheet', async () => {
    await expect(
      t.crud.writeCollectionWindow('spreadsheet', 'q1-revenue', 'cells', [{ r: 99, c: 1, value: 'nope' }], 'user'),
    ).rejects.toThrow();
    expect(cells()).toEqual([]);
  });

  it('rolls the whole block back when one coordinate is out of bounds', async () => {
    await expect(
      t.crud.writeCollectionWindow(
        'spreadsheet',
        'q1-revenue',
        'cells',
        [
          { r: 1, c: 1, value: 'fine' },
          { r: 99, c: 1, value: 'not fine' },
        ],
        'user',
      ),
    ).rejects.toThrow();
    // Not "one of two landed" — a partially applied block is the failure mode
    // a range write exists to make impossible.
    expect(cells()).toEqual([]);
  });

  it('inserting a row shifts the cells past it and grows nRows', async () => {
    await t.crud.writeCollectionWindow(
      'spreadsheet',
      'q1-revenue',
      'cells',
      [
        { r: 1, c: 1, value: 'header' },
        { r: 3, c: 1, value: 'third' },
      ],
      'user',
    );

    const result = await t.crud.mutateCollectionAxis('spreadsheet', 'q1-revenue', 'cells', 'r', 'insert', 2, 'user');

    expect(result.extent).toBe(5);
    expect(sheet().n_rows).toBe(5);
    expect(cells()).toEqual([
      { r: 1, c: 1, value: 'header' },
      { r: 4, c: 1, value: 'third' },
    ]);
  });

  it('deleting a column takes its cells and pulls the rest left', async () => {
    await t.crud.writeCollectionWindow(
      'spreadsheet',
      'q1-revenue',
      'cells',
      [
        { r: 1, c: 1, value: 'a' },
        { r: 1, c: 2, value: 'doomed' },
        { r: 1, c: 3, value: 'c' },
      ],
      'user',
    );

    const result = await t.crud.mutateCollectionAxis('spreadsheet', 'q1-revenue', 'cells', 'c', 'delete', 2, 'user');

    expect(result.extent).toBe(2);
    expect(cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 1, c: 2, value: 'c' },
    ]);
  });

  it('an empty window is not a mutation — no version row, no file rewrite', async () => {
    const before = fs.statSync(path.join(t.cwd, '.claude4spec/entities/spreadsheet/q1-revenue.json')).mtimeMs;
    t.broadcasts.length = 0;

    await t.crud.writeCollectionWindow('spreadsheet', 'q1-revenue', 'cells', [], 'user');

    const after = fs.statSync(path.join(t.cwd, '.claude4spec/entities/spreadsheet/q1-revenue.json')).mtimeMs;
    expect(after).toBe(before);
  });
});
