/**
 * `genericWriteCollectionWindow` / `genericMutateCollectionAxis` — the host half
 * of the keyed-collection write, one layer below `ctx.crud`.
 *
 * The facade WRAPPERS (the async binding and the `entity:changed` broadcast in
 * `project-context.ts`) are exercised in `tests/integration/plugin-host/`, where
 * a registered type and a real `ws` exist; here everything is synchronous.
 *
 * The domain semantics (merge vs replace, the parent stamp, one `entity_version`
 * per call, sparse deletion, axis reindexing) belong to `writeKeyedWindow` /
 * `mutateAxis` and are pinned in `db/projection-write.test.ts`. What is only
 * observable HERE is the wrapping — and the wrapping is where this pair spent
 * its whole life broken: both write functions were complete, correct and had no
 * caller at all, so a plugin's only route to one cell was `crud.update`, which
 * reconciles a supplied keyed collection replace-all.
 *
 * So the cases below are the ones a re-implementation would get wrong:
 *
 *   - the entity FILE is persisted after the write. The grid is part of the
 *     snapshot, so skipping this leaves the file describing a grid the database
 *     no longer has — and the next rebuild restores the stale one over it;
 *   - the write function's own capture is left alone. Wrapping these in the
 *     module's `inOneTransaction` + `capture()`, the way create/update need,
 *     would produce TWO version rows for one operation, which is exactly the
 *     guarantee the operation exists to make;
 *   - the module lookup happens here, so an unknown type is a `VALIDATION`
 *     error rather than a crash inside the write path.
 */

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection } from '../../db/projection.js';
import { upsertProjectionRow, type WritableModule } from '../../db/projection-write.js';
import { DomainError } from '../../services/tags.js';
import {
  genericMutateCollectionAxis,
  genericWriteCollectionWindow,
  type GenericCrudDeps,
} from './generic-crud.js';

const grid: WritableModule = {
  type: 'grid',
  payloadVersion: 1,
  data: {
    schema: {
      title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
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

interface Harness {
  deps: GenericCrudDeps;
  db: Database.Database;
  persist: ReturnType<typeof vi.fn>;
  captureEntitySnapshot: ReturnType<typeof vi.fn>;
  cells: () => unknown[];
}

/**
 * A `grid` with two cells, wired through the same deps shape `buildProjectContext`
 * assembles — only the handles these two operations actually touch are real.
 * `tags` and `references` are absent on purpose: reaching for either would mean
 * the wrapping had grown a step neither operation can need (no tag is assigned,
 * no slug can change), and the failure would be a TypeError naming the step.
 */
function harness(cells = [cell(1, 1, 'a'), cell(2, 2, 'b')], extent = 3): Harness {
  const db = new Database(':memory:');
  applyProjection(db, [grid]);
  upsertProjectionRow(
    { db, versions: null },
    grid,
    'g1',
    { name: 'g', nRows: extent, nCols: extent, cells },
    'user',
    { capture: false, writeFile: false },
  );

  const persist = vi.fn();
  const captureEntitySnapshot = vi.fn();
  const deps = {
    host: { getEntity: (type: string) => (type === 'grid' ? grid : undefined) },
    store: { persist },
    projection: { db, versions: { captureEntitySnapshot } },
  } as unknown as GenericCrudDeps;

  return {
    deps,
    db,
    persist,
    captureEntitySnapshot,
    cells: () => db.prepare('SELECT r, c, value FROM grid_cells ORDER BY r, c').all(),
  };
}

describe('genericWriteCollectionWindow', () => {
  it('delegates the point write and merges — keys it did not name survive', () => {
    const t = harness();
    const result = genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', [cell(3, 3, 'c')], 'user');

    expect(result).toEqual({ slug: 'g1' });
    expect(t.cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
      { r: 3, c: 3, value: 'c' },
    ]);
  });

  it('persists the entity file once, and captures exactly one version — for one key or a hundred', () => {
    // `KEYED_OPTS` keeps `capture: true` so the write function's own capture at
    // the close of its transaction is the only one. A second capture out here
    // would double every row count below.
    const t = harness([], 10);
    const hundred = Array.from({ length: 100 }, (_, i) => cell(Math.floor(i / 10) + 1, (i % 10) + 1, `v${i}`));
    genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', hundred, 'user');

    expect(t.captureEntitySnapshot).toHaveBeenCalledTimes(1);
    expect(t.persist).toHaveBeenCalledTimes(1);
    expect(t.persist).toHaveBeenCalledWith('grid', 'g1');
  });

  it('forwards the ACTOR to the version capture — the one argument this layer owns', () => {
    // Counts alone let a wrapper hard-code `'system'`, or pass `type` into the
    // actor slot, and stay green while every keyed write in production is
    // attributed to the wrong author.
    const t = harness();
    genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', [cell(1, 1, 'x')], 'agent');
    expect(t.captureEntitySnapshot).toHaveBeenCalledWith('grid', 'g1', 'update', 'agent', 'Updated');
  });

  it('an empty window is not a mutation — no version, no stamp, no file write', () => {
    // A grid editor flushing a dirty-cell batch on a timer calls this with
    // nothing to send; running the body anyway climbed the entity up the
    // recency order and filled its history with identical entries.
    const t = harness();
    t.db.prepare(`UPDATE grid SET updated_at = '2000-01-01T00:00:00.000Z' WHERE slug = 'g1'`).run();

    expect(genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', [], 'user')).toEqual({ slug: 'g1' });

    expect(t.captureEntitySnapshot).not.toHaveBeenCalled();
    expect(t.persist).not.toHaveBeenCalled();
    expect(t.db.prepare(`SELECT updated_at FROM grid WHERE slug = 'g1'`).get()).toEqual({
      updated_at: '2000-01-01T00:00:00.000Z',
    });
  });

  it('still validates the field when the window is empty', () => {
    // The short-circuit is after the declaration check, not before it.
    const t = harness();
    expect(() => genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'name', [], 'user')).toThrow(
      /not a keyed collection/,
    );
  });

  it('stamps the parent, and the stamped row is what gets persisted', () => {
    // Persist AFTER the write, never before: the file is written from the row.
    const t = harness();
    t.db.prepare(`UPDATE grid SET updated_at = '2000-01-01T00:00:00.000Z' WHERE slug = 'g1'`).run();
    t.persist.mockImplementation(() => {
      const row = t.db.prepare(`SELECT updated_at FROM grid WHERE slug = 'g1'`).get() as { updated_at: string };
      expect(row.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
    });

    genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', [cell(1, 2, 'x')], 'user');
    expect(t.persist).toHaveBeenCalledTimes(1);
  });

  it('writing an empty value deletes the key', () => {
    const t = harness();
    genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', [cell(1, 1, '')], 'user');
    expect(t.cells()).toEqual([{ r: 2, c: 2, value: 'b' }]);
  });

  it('rejects an unknown type as VALIDATION, before any write is attempted', () => {
    const t = harness();
    expect(() =>
      genericWriteCollectionWindow(t.deps, 'nope', 'g1', 'cells', [cell(1, 1, 'x')], 'user'),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(t.persist).not.toHaveBeenCalled();
  });

  it('rejects a non-array entry list as VALIDATION, not as a raw TypeError', () => {
    // `MountContext.crud` is published as `any`, so the parameter type narrows
    // nothing for a plugin forwarding an HTTP body. A `TypeError` reaches the
    // client as a 500; a `DomainError` reaches it as the 4xx it is.
    const t = harness();
    expect(() =>
      genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', cell(1, 1, 'x') as never, 'user'),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(t.persist).not.toHaveBeenCalled();
  });

  it('rejects a coordinate past the declared extent instead of hiding a cell behind it', () => {
    // `overview` reports the grid from the parent's extent columns, so a cell
    // past them is unreachable — and `mutateCollectionAxis` refuses to delete a
    // position past the extent, so it cannot even be removed afterwards.
    const t = harness();
    expect(() =>
      genericWriteCollectionWindow(t.deps, 'grid', 'g1', 'cells', [cell(9, 9, 'far')], 'user'),
    ).toThrow(/past the declared extent/);
    expect(t.cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
    ]);
    expect(t.persist).not.toHaveBeenCalled();
  });

  it('rolls the WHOLE window back when one entry is rejected', () => {
    // The restore path degrades a bad entry to a warning because throwing there
    // empties the collection. This door has nothing to protect: reporting a
    // rejected cell as `{slug}` — success — while stamping and versioning the
    // entity around a value that never landed is the worse answer.
    const t = harness();
    expect(() =>
      genericWriteCollectionWindow(
        t.deps,
        'grid',
        'g1',
        'cells',
        [cell(3, 3, 'good'), { r: 0, c: 1, value: 'unusable key' }],
        'user',
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));

    // Not even the entry that was fine.
    expect(t.cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 2, value: 'b' },
    ]);
    expect(t.captureEntitySnapshot).not.toHaveBeenCalled();
    expect(t.persist).not.toHaveBeenCalled();
  });

  it('does not persist a file for an entity the write refused', () => {
    // A missing slug throws out of `writeKeyedWindow`; the persist must not run
    // anyway, or the store is asked to serialize an entity that does not exist.
    const t = harness();
    expect(() => genericWriteCollectionWindow(t.deps, 'grid', 'ghost', 'cells', [cell(1, 1, 'x')], 'user')).toThrow(
      /not found/,
    );
    expect(t.persist).not.toHaveBeenCalled();
    expect(t.captureEntitySnapshot).not.toHaveBeenCalled();
  });
});

describe('genericMutateCollectionAxis', () => {
  it('delegates the insert, returns the new extent, and persists', () => {
    const t = harness([cell(1, 1, 'a'), cell(2, 1, 'b')]);
    const result = genericMutateCollectionAxis(t.deps, 'grid', 'g1', 'cells', 'r', 'insert', 2, 'user');

    expect(result).toEqual({ slug: 'g1', extent: 4 });
    expect(t.cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 3, c: 1, value: 'b' },
    ]);
    expect(t.persist).toHaveBeenCalledExactlyOnceWith('grid', 'g1');
    expect(t.captureEntitySnapshot).toHaveBeenCalledTimes(1);
  });

  it('delegates the delete, pulling the rest of the axis back', () => {
    const t = harness([cell(1, 1, 'a'), cell(2, 1, 'b'), cell(3, 1, 'c')]);
    const result = genericMutateCollectionAxis(t.deps, 'grid', 'g1', 'cells', 'r', 'delete', 2, 'user');

    expect(result).toEqual({ slug: 'g1', extent: 2 });
    expect(t.cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 1, value: 'c' },
    ]);
  });

  it('forwards the ACTOR to the version capture', () => {
    const t = harness();
    genericMutateCollectionAxis(t.deps, 'grid', 'g1', 'cells', 'r', 'insert', 1, 'agent');
    expect(t.captureEntitySnapshot).toHaveBeenCalledWith('grid', 'g1', 'update', 'agent', 'Updated');
  });

  it('surfaces the write path\'s own errors rather than restating them', () => {
    const t = harness();
    expect(() => genericMutateCollectionAxis(t.deps, 'grid', 'g1', 'cells', 'z', 'insert', 1, 'user')).toThrow(
      /has no axis 'z'/,
    );
    expect(() => genericMutateCollectionAxis(t.deps, 'grid', 'g1', 'name', 'r', 'insert', 1, 'user')).toThrow(
      /is not a keyed collection/,
    );
    expect(t.persist).not.toHaveBeenCalled();
  });

  it('refuses an op outside the vocabulary instead of inserting while shrinking', () => {
    // `'remove'` took the INSERT arm (`op !== 'delete'`) while the extent came
    // from the DELETE arm (`op !== 'insert'`): nothing was removed, every row
    // past the position was pushed down, and the parent then claimed one row
    // fewer than the cells occupy — cells no window can address again.
    const t = harness([cell(1, 1, 'a'), cell(2, 1, 'b'), cell(3, 1, 'c')]);
    expect(() =>
      genericMutateCollectionAxis(t.deps, 'grid', 'g1', 'cells', 'r', 'remove' as never, 2, 'user'),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION' }));

    expect(t.cells()).toEqual([
      { r: 1, c: 1, value: 'a' },
      { r: 2, c: 1, value: 'b' },
      { r: 3, c: 1, value: 'c' },
    ]);
    expect(t.db.prepare(`SELECT n_rows FROM grid WHERE slug = 'g1'`).get()).toEqual({ n_rows: 3 });
    expect(t.persist).not.toHaveBeenCalled();
  });
});
