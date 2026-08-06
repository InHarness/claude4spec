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
        name: 'order_items',
        columns: [
          { name: 'id', type: 'uuid', pk: true },
          { name: 'sku', type: 'text' },
          { name: 'qty', type: 'integer' },
        ],
        indexes: [{ columns: ['sku'] }, { columns: ['id', 'sku'], name: 'ix_custom', unique: true }],
      },
      'user',
    );
    await t.crud.create('database-table', { name: 'keyless', columns: [{ name: 'a', type: 'text' }] }, 'user');
  });
  afterEach(() => t.cleanup());

  const list = async () => (await request(t.app).get('/api/database-tables')).body.data as Array<Record<string, unknown>>;
  /** The bare GET is `single_element` — the summary. `?view=detail` is the full record. */
  const one = async (slug: string) =>
    (await request(t.app).get(`/api/database-tables/${slug}`)).body.data as Record<string, unknown>;
  const detail = async (slug: string) =>
    (await request(t.app).get(`/api/database-tables/${slug}?view=detail`)).body.data as Record<
      string,
      unknown
    >;

  it('projects a list row to counts, not to the arrays themselves', async () => {
    const rows = await list();
    const row = rows.find((r) => r.slug === 'order-items')!;
    expect(row.columnCount).toBe(3);
    expect(row.indexCount).toBe(2);
    expect(row.name).toBe('order_items');
  });

  /**
   * THE ONE THAT MATTERS. If this passes while the view is the generic one, it
   * is because someone deleted the override and the list is now shipping the
   * whole schema to a screen that renders a single line from it.
   */
  it('never ships the collections themselves in a list row', async () => {
    const row = (await list()).find((r) => r.slug === 'order-items')!;
    expect(row).not.toHaveProperty('columns');
    expect(row).not.toHaveProperty('indexes');
  });

  it('derives hasPrimaryKey, which is a predicate and not a field', async () => {
    const rows = await list();
    expect(rows.find((r) => r.slug === 'order-items')!.hasPrimaryKey).toBe(true);
    expect(rows.find((r) => r.slug === 'keyless')!.hasPrimaryKey).toBe(false);
  });

  it('summarises on the bare GET, and keeps the collections on ?view=detail', async () => {
    const summary = await one('order-items');
    expect(summary.columnCount).toBe(3);
    expect(summary).not.toHaveProperty('columns');

    const full = await detail('order-items');
    expect(full.columns).toHaveLength(3);
    expect(full.indexes).toHaveLength(2);
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
      const full = await detail('order-items');
      const [first] = full.indexes as Array<Record<string, unknown>>;
      expect(first).not.toHaveProperty('name');
    });
  });
});
