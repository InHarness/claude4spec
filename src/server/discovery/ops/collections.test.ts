/**
 * M39 L2 — the keyed-collection read surface (tier C, items 17–18).
 *
 * The two properties worth pinning are the ones a reasonable implementation gets
 * wrong in opposite directions:
 *
 *   - `overview` must be CHEAP, and "cheap" here has a testable meaning rather
 *     than a benchmark: it does not touch the collection's table at all. The
 *     test drops the table and asserts the call still answers — which no
 *     implementation that counts, maxes or samples the items can pass.
 *   - `window` must be DENSE over the rectangle asked for. A sparse store
 *     returns fewer rows than the rectangle has cells, and mapping the query
 *     result gives a ragged array a caller cannot address by coordinate.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyProjection } from '../../db/projection.js';
import { RawEntityReader } from '../raw-entity-reader.js';
import type { ProjectPluginHost } from '../../core/plugin-host/types.js';
import type { DiscoveryDeps } from '../types.js';
import { collectionOverview, collectionWindow, MAX_WINDOW_CELLS } from './collections.js';

const grid = {
  type: 'grid',
  payloadVersion: 1,
  data: {
    schema: {
      title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
      name: { type: 'string', required: true },
      nRows: { type: 'number', column: 'n_rows', default: 0 },
      nCols: { type: 'number', column: 'n_cols', default: 0 },
      cells: {
        type: 'collection',
        collection: 'keyed',
        keyFields: ['r', 'c'],
        axes: [
          { key: 'r', extent: 'nRows' },
          { key: 'c', extent: 'nCols' },
        ],
        item: {
          type: 'object',
          fields: {
            r: { type: 'number', required: true },
            c: { type: 'number', required: true },
            value: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

let db: Database.Database;
let deps: DiscoveryDeps;

function host(modules: readonly unknown[]): ProjectPluginHost {
  return {
    getEntity: (t: string) => modules.find((m) => (m as { type: string }).type === t) ?? null,
    listEntities: () => modules,
  } as unknown as ProjectPluginHost;
}

beforeEach(() => {
  db = new Database(':memory:');
  applyProjection(db, [grid as never]);
  db.prepare(`INSERT INTO grid (slug, name, n_rows, n_cols) VALUES ('g1', 'G', 4, 3)`).run();
  // SPARSE on purpose: three cells in a 4×3 grid. Nine coordinates have no row.
  for (const [r, c, value] of [
    [1, 1, 'a'],
    [2, 3, 'b'],
    [4, 1, 'd'],
  ] as const) {
    db.prepare(`INSERT INTO grid_cells (grid_slug, r, c, value) VALUES (?, ?, ?, ?)`).run('g1', r, c, value);
  }
  deps = {
    db,
    reader: new RawEntityReader(db, host([grid])),
    host: host([grid]),
  } as unknown as DiscoveryDeps;
});
afterEach(() => db.close());

describe('collectionOverview', () => {
  it('reports the dimensions from the PARENT, not from the stored coordinates', () => {
    const result = collectionOverview(deps, { type: 'grid', slug: 'g1', field: 'cells' });
    expect(result.axes).toEqual([
      { key: 'r', extent: 'nRows', length: 4 },
      { key: 'c', extent: 'nCols', length: 3 },
    ]);
    expect(result.itemFields).toEqual(['value']);
  });

  it('keeps reporting the declared size when the far corner is empty', () => {
    // Trailing empty rows are METADATA. A `MAX(r)` implementation would answer 4
    // here and 2 after this delete, shrinking the grid because someone cleared a
    // cell — the exact failure sparse discipline forbids.
    db.prepare(`DELETE FROM grid_cells WHERE r = 4`).run();
    const result = collectionOverview(deps, { type: 'grid', slug: 'g1', field: 'cells' });
    expect(result.axes[0]!.length).toBe(4);
  });

  it('does not read the collection table AT ALL', () => {
    // The strongest available statement of "overview never materializes item
    // bodies": with the table gone, any implementation that queries it throws.
    db.exec('DROP TABLE grid_cells');
    expect(() => collectionOverview(deps, { type: 'grid', slug: 'g1', field: 'cells' })).not.toThrow();
  });

  it('refuses an unknown entity with the slugs that do exist', () => {
    expect(() => collectionOverview(deps, { type: 'grid', slug: 'nope', field: 'cells' })).toThrow(
      /no grid with slug 'nope'/,
    );
  });

  it('refuses a field that is not a keyed collection, naming the ones that are', () => {
    expect(() => collectionOverview(deps, { type: 'grid', slug: 'g1', field: 'name' })).toThrow(
      /'name' is not a keyed collection of grid/,
    );
  });
});

describe('collectionWindow', () => {
  const win = (a1: number, b1: number, a2: number, b2: number) =>
    collectionWindow(deps, { type: 'grid', slug: 'g1', field: 'cells', a1, b1, a2, b2 });

  it('returns the exact rectangle, DENSE, with empties materialized', () => {
    const { items } = win(1, 1, 2, 3);
    expect(items).toEqual([
      [{ value: 'a' }, { value: null }, { value: null }],
      [{ value: null }, { value: null }, { value: 'b' }],
    ]);
  });

  it('addresses cells by coordinate offset, which is what dense buys', () => {
    const { items } = win(2, 2, 4, 3);
    // (4,1) is outside the rectangle and must not appear; (2,3) is at [0][1].
    expect(items[0]![1]).toEqual({ value: 'b' });
    expect(items.flat().filter((cell) => (cell as { value: unknown }).value === 'd')).toEqual([]);
  });

  it('reads a full row as a degenerate window, not a separate primitive', () => {
    const { items } = win(2, 1, 2, 3);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual([{ value: null }, { value: null }, { value: 'b' }]);
  });

  it('reads a full column the same way', () => {
    const { items } = win(1, 1, 4, 1);
    expect(items.map((line) => line[0])).toEqual([
      { value: 'a' },
      { value: null },
      { value: null },
      { value: 'd' },
    ]);
  });

  it('does not clamp to the extents — past the end reads as empty', () => {
    // `overview` is where you learn the size. Silently returning a smaller
    // rectangle would force the caller to re-measure the answer it got.
    const { items } = win(6, 1, 7, 2);
    expect(items).toEqual([
      [{ value: null }, { value: null }],
      [{ value: null }, { value: null }],
    ]);
  });

  it('echoes the window it read, so the caller can map coordinates back', () => {
    expect(win(2, 1, 3, 2).window).toEqual([
      { key: 'r', from: 2, to: 3 },
      { key: 'c', from: 1, to: 2 },
    ]);
  });

  it('refuses a 0-based or fractional coordinate with the call that would work', () => {
    expect(() => win(0, 1, 2, 2)).toThrow(/a1 must be an integer >= 1/);
    expect(() => win(1, 1, 2.5, 2)).toThrow(/a2 must be an integer >= 1/);
  });

  it('refuses an inverted rectangle rather than silently returning nothing', () => {
    expect(() => win(3, 1, 2, 2)).toThrow(/upper bound must not be below the lower one/);
  });

  it('refuses a window past the per-call cell budget', () => {
    expect(() => win(1, 1, MAX_WINDOW_CELLS, 2)).toThrow(/past the per-call limit/);
  });

  it('reads an unapplied projection as an empty window rather than throwing', () => {
    // A type can be active with its projection not yet built; there is
    // genuinely nothing to read, and 500ing a whole page over it is worse.
    db.exec('DROP TABLE grid_cells');
    expect(win(1, 1, 1, 2).items).toEqual([[{ value: null }, { value: null }]]);
  });
});
