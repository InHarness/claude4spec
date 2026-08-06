/**
 * WHERE the soft-FK warning actually surfaces, and where a legacy name is
 * allowed to live.
 *
 * Both of these were wrong in the first cut of this port and neither failed
 * loudly, which is why they are pinned here rather than left to the corpus
 * golden: that golden called `danglingScalarRefs` DIRECTLY, so it proved the
 * function and not the wiring.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';

describe('database-table — the doors a user actually reaches', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await t.crud.create('database-table', { name: 'orders', columns: [] }, 'user');
  });
  afterEach(() => t.cleanup());

  const withFk = (table: string) => ({
    name: 'order_items',
    columns: [{ name: 'order_id', type: 'uuid', fk: { table, column: 'id' } }],
  });

  /**
   * The regression. `danglingScalarRefs` had exactly one caller —
   * `HostEntityWriter.upsert` — and the REST/MCP door goes through
   * `genericCreate`/`genericUpdate`, which never called it. So a broken `fk`
   * typed into the UI came back 200, silent, while only a release restore ever
   * reported it.
   */
  it('reports a dangling fk on CREATE through the REST door', async () => {
    const res = await request(t.app).post('/api/database-tables').send(withFk('nope'));
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).toMatch(/dangling/);
  });

  it('reports a dangling fk on UPDATE through the REST door', async () => {
    await request(t.app).post('/api/database-tables').send(withFk('orders'));
    const res = await request(t.app)
      .patch('/api/database-tables/order-items')
      .send({ columns: [{ name: 'order_id', type: 'uuid', fk: { table: 'gone', column: 'id' } }] });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/dangling/);
  });

  it('says nothing when the target resolves', async () => {
    const res = await request(t.app).post('/api/database-tables').send(withFk('orders'));
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/dangling/);
  });

  it('warns without refusing — the table is still created', async () => {
    await request(t.app).post('/api/database-tables').send(withFk('nope'));
    const row = t.db.prepare('SELECT slug FROM database_table WHERE slug = ?').get('order-items');
    expect(row).toBeDefined();
  });

  /**
   * A name the retired plugin accepted (it validated `name` as a bare string)
   * must still be READABLE. Indexing bypasses the generated schema on purpose —
   * refusing it would make the type unable to adopt its own history — and the
   * editor must not resend an untouched illegal name and lock the user out.
   */
  it('indexes a table whose inherited name is a reserved word', async () => {
    await expect(
      t.crud.create('database-table', { name: 'order', columns: [] }, 'user'),
    ).resolves.toBeTruthy();
    expect(
      t.db.prepare('SELECT name FROM database_table WHERE slug = ?').get('order'),
    ).toEqual({ name: 'order' });
  });

  it('lets an inherited illegal name be edited WITHOUT resending the name', async () => {
    // Exactly what the detail panel now sends: only the fields that changed.
    await t.crud.create('database-table', { name: 'order', columns: [] }, 'user');
    const res = await request(t.app)
      .patch('/api/database-tables/order')
      .send({ description: 'Customer orders.' });
    expect(res.status).toBe(200);
    // …while resending it still refuses, which is what makes the omission matter.
    const resend = await request(t.app)
      .patch('/api/database-tables/order')
      .send({ name: 'order', description: 'x' });
    expect(resend.status).toBe(400);
  });
});
