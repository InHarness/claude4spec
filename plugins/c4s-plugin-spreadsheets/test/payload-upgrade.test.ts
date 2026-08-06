/**
 * The v1 → v2 payload migration.
 *
 * The stakes: every spreadsheet file on disk was written by the v1 plugin in the
 * dense `cells: string[][]` shape, and the host's keyed restore reads a flat
 * array of items. Without this step each dense ROW is read as one item, every
 * key tuple comes out `null`, nothing lands, and a sheet whose content is intact
 * on disk reads back empty — silently. So these cases are about a real corpus,
 * not a hypothetical one, and two of the fixtures below are copied verbatim from
 * files that exist today.
 */

import { describe, expect, it } from 'vitest';
import { denseCellsToSparse, spreadsheetPayloadUpgrades } from '../src/entity/spreadsheet/upgrades.js';

/** Verbatim from `app-spec/.claude4spec/entities/spreadsheet/pliki-external.json`. */
const REAL_DENSE = {
  slug: 'pliki-external',
  name: 'external/ — kontrakty użycia paczek zewnętrznych',
  nRows: 2,
  nCols: 2,
  headerRow: true,
  headerCol: false,
  cells: [
    ['Plik', 'Opisuje'],
    ['@external/inharness-packages.md', '`@inharness/agent-adapters` + `@inharness/agent-chat`'],
  ],
};

/** Verbatim from the `demo-c4s` seed — written before `cells` was always emitted. */
const REAL_NO_CELLS = {
  slug: 'cennik-2026',
  name: 'Cennik 2026',
  nRows: 3,
  nCols: 2,
  headerRow: true,
  headerCol: false,
};

const up = (payload: unknown) => denseCellsToSparse(payload) as Record<string, unknown>;

describe('dense → sparse payload upgrade', () => {
  it('is the only step, and matches the declared payloadVersion of 2', () => {
    // Registration refuses `payloadVersion: n` without exactly n-1 steps, so
    // this pins the pair that must move together.
    expect(spreadsheetPayloadUpgrades).toHaveLength(1);
  });

  it('turns a real v1 file into 1-based keyed cells', () => {
    expect(up(REAL_DENSE).cells).toEqual([
      { r: 1, c: 1, value: 'Plik' },
      { r: 1, c: 2, value: 'Opisuje' },
      { r: 2, c: 1, value: '@external/inharness-packages.md' },
      { r: 2, c: 2, value: '`@inharness/agent-adapters` + `@inharness/agent-chat`' },
    ]);
  });

  it('leaves everything that is not `cells` alone', () => {
    const out = up(REAL_DENSE);
    expect(out.slug).toBe('pliki-external');
    expect(out.name).toBe(REAL_DENSE.name);
    expect(out.nRows).toBe(2);
    expect(out.nCols).toBe(2);
    expect(out.headerRow).toBe(true);
    expect(out.headerCol).toBe(false);
  });

  it('drops empty cells, because a keyed collection stores no blanks', () => {
    const out = up({ nRows: 2, nCols: 3, cells: [['a', '', 'c'], ['', '', '']] });
    expect(out.cells).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 1, c: 3, value: 'c' },
    ]);
  });

  it('keeps a cell holding "0" — falsy is not empty', () => {
    // Deleting a `0` because it looks falsy would lose authored content on
    // every rebuild. Only absence and `''` are empty.
    const out = up({ nRows: 1, nCols: 2, cells: [['0', '']] });
    expect(out.cells).toEqual([{ r: 1, c: 1, value: '0' }]);
  });

  it('upgrades a file that never had a `cells` key at all', () => {
    const out = up(REAL_NO_CELLS);
    expect(out.cells).toEqual([]);
    // The dimensions survive: they are the axis extents, not a cell count.
    expect(out.nRows).toBe(3);
    expect(out.nCols).toBe(2);
  });

  it('does not shrink authored dimensions to fit the dense array', () => {
    /**
     * A sheet declared 10 rows with content only in the first two is a sheet
     * with eight trailing empty rows — a fact about the sheet, not a
     * disagreement to correct. `overview` reports the grid from the extents.
     */
    const out = up({ nRows: 10, nCols: 4, cells: [['a'], ['b']] });
    expect(out.nRows).toBe(10);
    expect(out.nCols).toBe(4);
  });

  it('backfills dimensions only when they are absent or unusable', () => {
    expect(up({ cells: [['a', 'b', 'c'], ['d', 'e', 'f']] })).toMatchObject({ nRows: 2, nCols: 3 });
    expect(up({ nRows: null, nCols: 'x', cells: [['a', 'b']] })).toMatchObject({ nRows: 1, nCols: 2 });
  });

  it('takes the widest row when the dense array is ragged', () => {
    expect(up({ cells: [['a'], ['b', 'c', 'd']] })).toMatchObject({ nCols: 3 });
  });

  it('is idempotent — an already-sparse payload passes through untouched', () => {
    /**
     * The failure this prevents is not theoretical: a second pass would read
     * `{r, c, value}` as a dense row and produce a grid of `[object Object]`.
     * It should be unreachable via the version marker, but "already migrated"
     * must never mean "migrate again".
     */
    const sparse = { nRows: 1, nCols: 1, cells: [{ r: 1, c: 1, value: 'a' }] };
    expect(up(sparse)).toEqual(sparse);
    expect(up(up(REAL_DENSE))).toEqual(up(REAL_DENSE));
  });

  it('leaves an empty grid empty rather than inventing a row', () => {
    expect(up({ nRows: 0, nCols: 0, cells: [] }).cells).toEqual([]);
  });

  it('refuses to guess at a payload it cannot read', () => {
    // A non-object, or a `cells` that is neither dense nor sparse, is passed
    // through for the host's gap classifier to report loudly.
    expect(denseCellsToSparse(null)).toBeNull();
    expect(denseCellsToSparse('nope')).toBe('nope');
    expect(up({ cells: 'nope' }).cells).toBe('nope');
  });

  it('coerces a non-string cell rather than dropping it', () => {
    // v1 typed cells as strings but nothing enforced it in the file.
    expect(up({ cells: [[1, true, null]] }).cells).toEqual([
      { r: 1, c: 1, value: '1' },
      { r: 1, c: 2, value: 'true' },
    ]);
  });

  it('skips a malformed row without taking the sheet down with it', () => {
    expect(up({ cells: [['a'], 'not-a-row', ['b']] }).cells).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 3, c: 1, value: 'b' },
    ]);
  });
});
