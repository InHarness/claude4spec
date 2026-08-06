/**
 * `spreadsheet-tools` and the read logic behind it.
 *
 * Two layers, because they fail differently. The server's REGISTRATION is only
 * observable through the host — a factory that throws on construction, or one
 * registered under a name the system prompt does not mention, leaves no other
 * trace. The read SHAPES are pure functions and are pinned directly, since
 * "overview carries labels but never body cells" is the type's whole discipline
 * and is the sort of thing that erodes one convenience at a time.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import { buildOverview, cellLookup, densify, metaOf, toSparseCells } from '../src/entity/spreadsheet/overview.js';
import type { RawEntity } from '../src/host-kit/host-types.js';

describe('the server the host registers', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('registers under the name the system prompt tells agents to use', () => {
    const names = t.host.buildMcpServers().map((s) => s.name);
    // Derived by the adapter as `${type}-tools`; the system prompt hard-codes
    // the same string, so a rename on either side must break something.
    expect(names).toContain('spreadsheet-tools');
  });

  it('builds without a domain service, because the type has none', () => {
    // 2.0.0 tier K dropped the `mcpServer requires service` rule. The factory is
    // handed `undefined` and must not reach for it.
    const built = t.host.buildMcpServers().find((s) => s.name === 'spreadsheet-tools');
    expect(built?.server).toBeDefined();
  });
});

const row = (data: Record<string, unknown>): RawEntity => ({
  type: 'spreadsheet',
  slug: 'sheet',
  data,
  tags: [],
});

describe('metaOf — reading the row the generic reader actually hands over', () => {
  it('takes COLUMN names and SQLite integer booleans', () => {
    /**
     * The row arrives with `n_rows` and `0`/`1`, not the `nRows`/`true` the
     * declaration is written in. Reading it as the declaration spells it yields
     * a 0×0 sheet with both header flags false — which renders as an empty grid
     * rather than as an error.
     */
    expect(metaOf(row({ name: 'S', n_rows: 4, n_cols: 3, header_row: 1, header_col: 0 }))).toEqual({
      slug: 'sheet',
      name: 'S',
      nRows: 4,
      nCols: 3,
      headerRow: true,
      headerCol: false,
    });
  });

  it('accepts the declaration spelling too, for a caller holding a snapshot', () => {
    expect(metaOf(row({ name: 'S', nRows: 2, nCols: 2, headerRow: true }))).toMatchObject({
      nRows: 2,
      nCols: 2,
      headerRow: true,
    });
  });

  it('degrades a missing field rather than throwing', () => {
    expect(metaOf(row({}))).toEqual({
      slug: 'sheet',
      name: '',
      nRows: 0,
      nCols: 0,
      headerRow: false,
      headerCol: false,
    });
  });
});

describe('buildOverview — shape plus labels, never body', () => {
  const cells = toSparseCells([
    { r: 1, c: 1, value: 'corner' },
    { r: 1, c: 2, value: 'Q1' },
    { r: 2, c: 1, value: 'North' },
    { r: 2, c: 2, value: 'BODY — must not appear' },
  ]);
  const at = cellLookup(cells);

  it('carries row-1 labels when headerRow, and no body cell with them', () => {
    const out = buildOverview(
      { slug: 's', name: 'S', nRows: 2, nCols: 2, headerRow: true, headerCol: false },
      at,
    );
    expect(out.headerRowLabels).toEqual(['corner', 'Q1']);
    expect(out.headerColLabels).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('BODY');
  });

  it('carries column-1 labels when headerCol', () => {
    const out = buildOverview(
      { slug: 's', name: 'S', nRows: 2, nCols: 2, headerRow: false, headerCol: true },
      at,
    );
    expect(out.headerColLabels).toEqual(['corner', 'North']);
  });

  it('repeats the corner in both lists when both flags are set', () => {
    // (1,1) is the label of row 1 AND of column 1. Not a duplicate to dedupe.
    const out = buildOverview({ slug: 's', name: 'S', nRows: 2, nCols: 2, headerRow: true, headerCol: true }, at);
    expect(out.headerRowLabels?.[0]).toBe('corner');
    expect(out.headerColLabels?.[0]).toBe('corner');
  });

  it('pads labels to the DECLARED extent, not to what was written', () => {
    // A sheet declared 4 columns with two labels written has two blank labels,
    // not a two-column sheet.
    const out = buildOverview({ slug: 's', name: 'S', nRows: 2, nCols: 4, headerRow: true, headerCol: false }, at);
    expect(out.headerRowLabels).toEqual(['corner', 'Q1', '', '']);
  });

  it('adds no label lists at all when neither flag is set', () => {
    const out = buildOverview({ slug: 's', name: 'S', nRows: 2, nCols: 2, headerRow: false, headerCol: false }, at);
    expect(out.headerRowLabels).toBeUndefined();
    expect(out.headerColLabels).toBeUndefined();
  });
});

describe('densify — the rectangle get_range answers with', () => {
  const at = cellLookup(toSparseCells([{ r: 2, c: 2, value: 'x' }]));

  it('fills unwritten coordinates with "" so the caller can index by offset', () => {
    expect(densify(at, 1, 1, 3, 3)).toEqual([
      ['', '', ''],
      ['', 'x', ''],
      ['', '', ''],
    ]);
  });

  it('is 1-based and inclusive on both ends', () => {
    expect(densify(at, 2, 2, 2, 2)).toEqual([['x']]);
  });

  it('answers a window past the end with blanks rather than a short array', () => {
    expect(densify(at, 5, 5, 6, 6)).toEqual([
      ['', ''],
      ['', ''],
    ]);
  });
});

describe('toSparseCells — coercing what the reader hands back', () => {
  it('drops rows with an unusable coordinate instead of failing the read', () => {
    expect(
      toSparseCells([
        { r: 1, c: 1, value: 'ok' },
        { r: 0, c: 1, value: 'zero is not a coordinate' },
        { r: 'x', c: 1, value: 'nor is a word' },
        null,
        'nope',
      ]),
    ).toEqual([{ r: 1, c: 1, value: 'ok' }]);
  });

  it('reads a missing value as empty rather than undefined', () => {
    expect(toSparseCells([{ r: 1, c: 1 }])).toEqual([{ r: 1, c: 1, value: '' }]);
  });
});
