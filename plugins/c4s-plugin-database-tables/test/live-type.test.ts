/**
 * The whole stack, on the REAL type rather than a fixture.
 *
 * `database-table` arrives through `loadBuiltinEnvelopes`, and nothing here
 * constructs it — which is the claim that matters, because under Host API 2.x
 * the type had stopped arriving at all: both packages that could contribute it
 * declare `hostApiVersion: '^1.0.0'` and the loader's gate drops them before
 * registration.
 *
 * It also pins the two rules the retired `database-table-tools` server used to
 * guard, now that the generic CRUD doors are the only doors — and pins WHERE
 * they hold. The generated schemas are applied at the REST router and at
 * `entity-tools`, not at the internal `crud` facade beneath them, and that
 * asymmetry is the design: the inner door is what restore and the index rebuild
 * write through, and they have to accept the corpus as it already is.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';

describe('database-table — the shipped type', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await t.crud.create(
      'database-table',
      {
        title: 'order_items',
        description: 'Line items of an order.',
        columns: [
          { name: 'id', type: 'uuid', pk: true, nullable: false },
          { name: 'order_id', type: 'uuid', fk: { table: 'orders', column: 'id' } },
        ],
        indexes: [{ columns: ['order_id'], name: 'ix_order_items_order_id' }],
      },
      'user',
    );
    t.broadcasts.length = 0;
  });
  afterEach(() => t.cleanup());

  const row = (slug = 'order-items') =>
    t.db.prepare('SELECT * FROM database_table WHERE slug = ?').get(slug) as
      | Record<string, string>
      | undefined;
  const entityFile = (slug = 'order-items') =>
    JSON.parse(
      fs.readFileSync(path.join(t.cwd, `.claude4spec/entities/database-table/${slug}.json`), 'utf8'),
    );

  it('is registered by the loader, not by this test', () => {
    expect(t.host.listEntities().map((m) => m.type)).toContain('database-table');
  });

  it('slugifies the name and keeps the SQL identifier intact', () => {
    const r = row();
    expect(r?.slug).toBe('order-items');
    expect(r?.title).toBe('order_items');
    // 0.2.27 — one name field, not two. The column the merge removed must be
    // gone from the projection, not merely unread.
    expect(r).not.toHaveProperty('name');
  });

  /**
   * The inherited storage shape, which is the entire adoption contract. The
   * collections are embedded JSON under the PLAIN column names the retired
   * plugin used — not `columns_json`, and not a junction table.
   */
  it('stores the collections as embedded JSON on the entity row', () => {
    const r = row();
    expect(JSON.parse(r!.columns)).toHaveLength(2);
    expect(JSON.parse(r!.indexes)).toHaveLength(1);
    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'database_table%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((x) => x.name)).toEqual(['database_table']);
  });

  it('preserves column order — the order is part of the table identity', async () => {
    await t.crud.update(
      'database-table',
      'order-items',
      {
        columns: [
          { name: 'order_id', type: 'uuid' },
          { name: 'id', type: 'uuid', pk: true },
        ],
      },
      'user',
    );
    expect(JSON.parse(row()!.columns).map((c: { name: string }) => c.name)).toEqual([
      'order_id',
      'id',
    ]);
  });

  /**
   * THE DOORS THAT VALIDATE, and the one that deliberately does not.
   *
   * The generated zod shapes are applied in exactly two places —
   * `generated-crud-router` (REST, what a client and this UI use) and
   * `entity-tools` (MCP, what an agent uses). Those are the doors the retired
   * `database-table-tools` server used to guard, and the reason it could be
   * retired.
   *
   * `crud.create` is the door BENEATH both, and it does not validate on
   * purpose: it is what restore and the index rebuild write through, and those
   * have to accept what is already on disk. Asserting the rule there would be
   * asserting that adoption is impossible.
   */
  describe('the identifier rule, at the doors that enforce it', () => {
    const post = (title: string) =>
      request(t.app).post('/api/database-tables').send({ title, columns: [] });

    const bad: Array<[string, string]> = [
      ['a name with spaces', 'order items'],
      ['a leading digit', '2fast'],
      ['a hyphen', 'order-list'],
      ['a reserved word', 'select'],
      ['a reserved word in caps', 'TABLE'],
      ['blank', '   '],
    ];

    for (const [why, name] of bad) {
      it(`refuses ${why}`, async () => {
        const res = await post(name);
        expect(res.status).toBe(400);
      });
    }

    it('accepts a mixed-case identifier and collapses it onto a lowercase slug', async () => {
      // `slugify` lowercases; the shape check has no business repeating it,
      // which is why the pattern is `[A-Za-z_]` and not `[a-z_]`.
      const res = await post('Order_Archive');
      expect(res.status).toBe(201);
      expect(row('order-archive')?.title).toBe('Order_Archive');
    });

    it('refuses a bad identifier on UPDATE, not only on create', async () => {
      // The update path had the identical hole, and a rename is exactly when a
      // bad identifier arrives.
      // Fields sit at the top level of a PATCH body; only `newSlug` is a
      // sibling with a special meaning.
      const res = await request(t.app)
        .patch('/api/database-tables/order-items')
        .send({ title: 'select' });
      expect(res.status).toBe(400);
    });

    it('names the reserved word, rather than reporting a shape mismatch', async () => {
      const res = await post('select');
      expect(JSON.stringify(res.body)).toMatch(/reserved SQL word/);
    });

    it('does NOT apply the rule to the internal write door, so adoption stays possible', async () => {
      // A corpus file naming a table `select` must still index. It is bad data,
      // and refusing to READ it would make the type unable to adopt its own
      // history.
      await expect(
        t.crud.create('database-table', { title: 'select', columns: [] }, 'user'),
      ).resolves.toBeTruthy();
    });
  });

  it('round-trips the file without inventing keys', () => {
    const file = entityFile();
    expect(file.title).toBe('order_items');
    expect(file.columns).toHaveLength(2);
    expect(file.indexes).toHaveLength(1);
    // Timestamps ride the envelope, not the declared body.
    expect(Object.keys(file)).toContain('createdAt');
  });
});
