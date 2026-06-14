import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';

describe('design-system REST + ui-view relation', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  const sampleGroups = [
    { name: 'Brand', tier: 'primitive', tokens: [{ name: 'blue-500', type: 'color', value: '#2563eb' }] },
    { name: 'Roles', tier: 'semantic', tokens: [{ name: 'color-action', type: 'color', value: '{blue-500}' }] },
  ];

  it('creates a design system and returns linter warnings (never blocks)', async () => {
    const res = await request(t.app)
      .post('/api/design-systems')
      .send({
        name: 'Brand 2026',
        groups: [
          { name: 'Roles', tier: 'semantic', tokens: [{ name: 'x', type: 'color', value: '{missing}' }] },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('brand-2026');
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes("alias '{missing}'"))).toBe(true);
  });

  it('lists, gets, and full-replaces groups on update', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });

    const list = await request(t.app).get('/api/design-systems');
    expect(list.status).toBe(200);
    expect(list.body.designSystems.map((d: { slug: string }) => d.slug)).toContain('brand');

    const get = await request(t.app).get('/api/design-systems/brand');
    expect(get.status).toBe(200);
    expect(get.body.groups).toHaveLength(2);

    const patched = await request(t.app)
      .patch('/api/design-systems/brand')
      .send({ groups: [{ name: 'Only', tier: 'primitive', tokens: [] }] });
    expect(patched.status).toBe(200);
    expect(patched.body.groups).toHaveLength(1);
    expect(patched.body.groups[0].name).toBe('Only');
  });

  it('ui-view accepts designSystemSlug (incl. a dangling one) and round-trips it', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });

    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });
    expect(view.status).toBe(201);
    expect(view.body.designSystemSlug).toBe('brand');

    // dangling reference is allowed (no FK) — write succeeds, value persists
    const dangling = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Ghost', designSystemSlug: 'does-not-exist' });
    expect(dangling.status).toBe(201);
    const gv = await request(t.app).get(`/api/ui-views/${dangling.body.slug}`);
    expect(gv.body.designSystemSlug).toBe('does-not-exist');
  });

  it('delete reports ui-views that become dangling', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });
    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });

    const del = await request(t.app).delete('/api/design-systems/brand');
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    expect(del.body.danglingUiViews).toEqual([{ slug: view.body.slug }]);
  });

  it('renaming a design-system propagates to ui-view.designSystemSlug', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });
    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });

    const renamed = await request(t.app)
      .patch('/api/design-systems/brand')
      .send({ newSlug: 'brand-2026' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.slug).toBe('brand-2026');

    const gv = await request(t.app).get(`/api/ui-views/${view.body.slug}`);
    expect(gv.body.designSystemSlug).toBe('brand-2026');
  });

  it('ui-view serializer is 1.1.0 and its snapshot carries designSystemSlug', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });
    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });

    expect(t.host.getEntity('ui-view')?.serializer.version).toBe('1.1.0');
    expect(t.host.getEntity('design-system')?.serializer.version).toBe('1.0.0');

    const ctx = { reader: t.rawReader, depth: 0, maxDepth: 1 };
    const snap = t.host.snapshot('ui-view', t.rawReader.getEntity('ui-view', view.body.slug), ctx) as {
      designSystemSlug: string | null;
    };
    expect(snap.designSystemSlug).toBe('brand');
  });

  it('slug conflict is the only hard error (409)', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand' });
    const dup = await request(t.app).post('/api/design-systems').send({ name: 'Brand' });
    expect(dup.status).toBe(409);
  });
});
