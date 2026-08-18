/**
 * RENAME — the second reward the `ref` declaration buys, and the one that
 * already worked at this depth before the warning did.
 *
 * `ref-rewrite`'s `rewriteValue` recurses through collection → object → object →
 * scalar and rewrites the embedded JSON column, so `columns[].fk.table` is
 * repointed with no per-type code at all. The retired plugin spent
 * `findReferencingColumns` + `repointForeignKeys` + a manual `removeFile` /
 * re-persist dance on exactly this.
 *
 * The distinction that matters, and the one the system prompt teaches: editing
 * `name` does NOT move the slug. Only `newSlug` does. A test that changed `name`
 * and asserted a rename would be asserting the opposite of the contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';

describe('database-table — rename repoints soft foreign keys', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await t.crud.create('database-table', { title: 'orders', columns: [] }, 'user');
    await t.crud.create(
      'database-table',
      {
        title: 'order_items',
        columns: [
          { name: 'order_id', type: 'uuid', fk: { table: 'orders', column: 'id' } },
          { name: 'sku', type: 'text' },
        ],
      },
      'user',
    );
    await t.crud.create(
      'database-table',
      {
        title: 'shipments',
        columns: [{ name: 'order_id', type: 'uuid', fk: { table: 'orders', column: 'id' } }],
      },
      'user',
    );
  });
  afterEach(() => t.cleanup());

  const fkOf = (slug: string, column: string) => {
    const row = t.db.prepare('SELECT columns FROM database_table WHERE slug = ?').get(slug) as {
      columns: string;
    };
    const cols = JSON.parse(row.columns) as Array<{ name: string; fk?: { table: string } }>;
    return cols.find((c) => c.name === column)?.fk?.table;
  };

  it('repoints every referencing column when the target is renamed', async () => {
    const res = await request(t.app)
      .patch('/api/database-tables/orders')
      .send({ title: 'sales_orders', newSlug: 'sales-orders' });
    expect(res.status).toBe(200);

    // Both referrers follow, and nothing had to know about `database-table`.
    expect(fkOf('order-items', 'order_id')).toBe('sales-orders');
    expect(fkOf('shipments', 'order_id')).toBe('sales-orders');
  });

  it('leaves a column with no fk alone', async () => {
    await request(t.app)
      .patch('/api/database-tables/orders')
      .send({ title: 'sales_orders', newSlug: 'sales-orders' });
    expect(fkOf('order-items', 'sku')).toBeUndefined();
  });

  /**
   * THE CONTRACT. `title` is the SQL identifier; the slug is derived from it
   * ONCE, at create. Editing the title later is not a rename — if it were, every
   * typo fix would move a slug that pages and foreign keys point at.
   *
   * The rule survived the 0.2.27 field merge unchanged, because it rests on the
   * slug being create-time and not on WHICH field seeded it.
   */
  it('does NOT move the slug when only `title` is edited', async () => {
    const res = await request(t.app)
      .patch('/api/database-tables/orders')
      .send({ title: 'sales_orders' });
    expect(res.status).toBe(200);

    const row = t.db.prepare('SELECT slug, title FROM database_table WHERE slug = ?').get('orders') as
      | { slug: string; title: string }
      | undefined;
    expect(row?.title).toBe('sales_orders');
    expect(row?.slug).toBe('orders');
    // …and therefore nothing was repointed.
    expect(fkOf('order-items', 'order_id')).toBe('orders');
  });
});
