/**
 * The three views that genuinely were specific to this type, and the one
 * structural fact the whole port rests on.
 *
 * `genericEntity` emits the declared fields verbatim, which for this type means
 * every column object of every table. That is right for `detail` and wrong for
 * every list: a corpus of 22 tables carries 186 column objects, and a screen
 * rendering one line per table would receive all of them. So the list views are
 * overridden — and the assertion that earns its keep here is the NEGATIVE one,
 * because a later "simplification" back to the generic view would look harmless
 * and would silently reinstate the payload.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import { deriveIndexName } from '../src/identity.js';

describe('database-table — serializer views', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await t.crud.create(
      'database-table',
      {
        title: 'order_items',
        columns: [
          { name: 'id', type: 'uuid', pk: true },
          { name: 'sku', type: 'text' },
          { name: 'qty', type: 'integer' },
        ],
        indexes: [{ columns: ['sku'] }, { columns: ['id', 'sku'], name: 'ix_custom', unique: true }],
      },
      'user',
    );
    await t.crud.create('database-table', { title: 'keyless', columns: [{ name: 'a', type: 'text' }] }, 'user');
  });
  afterEach(() => t.cleanup());

  const list = async () => (await request(t.app).get('/api/database-tables')).body.data as Array<Record<string, unknown>>;
  /** Since 0.2.22 there is one shape: `?view=` is gone and a GET is the record. */
  const one = async (slug: string) =>
    (await request(t.app).get(`/api/database-tables/${slug}`)).body.data as Record<string, unknown>;

  /**
   * 0.2.22 — a UI list row carries the SAME projection as every other read.
   *
   * This used to assert the opposite: the type computed `columnCount` /
   * `indexCount` / `hasPrimaryKey` for its `element_list_item` view precisely so
   * that a list screen never received the arrays. That kind of per-type computed
   * list field is what the release retires — `diagram.sourceLines` was removed
   * by name for the same reason — because width is now the caller's to state and
   * a type inventing a narrower shape puts the choice back where it was.
   *
   * The counts are still available to the screen: they are `columns.length`, and
   * the row renderer derives them. A field genuinely too big to travel says so
   * with `contentBearing`, which is the mechanism that replaces the guesswork.
   */
  it('carries the declared collections in a list row, counts derivable from them', async () => {
    const rows = await list();
    const row = rows.find((r) => r.slug === 'order-items')!;
    expect(row.columns).toHaveLength(3);
    expect(row.indexes).toHaveLength(2);
    expect(row.title).toBe('order_items');
  });

  /**
   * A GET carries the FULL record.
   *
   * It was once a counts-only summary, which read fine for an inline page embed
   * and was wrong for the other consumer: an agent resolving a table before
   * writing a migration got a column COUNT and no column names, types or foreign
   * keys. Since 0.2.22 there is no narrower default to fall into.
   */
  it('carries the collections on a plain GET', async () => {
    const summary = await one('order-items');
    expect(summary.columns).toHaveLength(3);
    expect(summary.indexes).toHaveLength(2);
  });

  describe('deriveIndexName', () => {
    it('derives a name from the indexed columns when the author wrote none', () => {
      expect(deriveIndexName('order_items', { columns: ['sku'] })).toBe('idx_order_items_sku');
      expect(deriveIndexName('order_items', { columns: ['a', 'b'] })).toBe('idx_order_items_a_b');
    });

    it('never overrides an authored name', () => {
      expect(deriveIndexName('order_items', { name: 'ix_custom', columns: ['sku'] })).toBe('ix_custom');
    });

    /**
     * Display-time only. Writing the derived name into the payload would
     * rewrite authored data on every snapshot and destroy the byte-identity the
     * version history rests on — so the stored index keeps its missing `name`.
     */
    it('does not write the derived name back into the entity', async () => {
      const full = await one('order-items');
      const [first] = full.indexes as Array<Record<string, unknown>>;
      expect(first).not.toHaveProperty('name');
    });
  });
});
