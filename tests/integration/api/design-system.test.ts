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

  /**
   * Item 60 — an unresolvable alias never blocked the write, and now it does not
   * decorate the response either.
   *
   * `warnings[]` was produced by `designSystemsRouter` on create and patch only,
   * so the identical tokens were "clean" when the page loaded them and "warned"
   * the moment you re-saved without touching anything. `lintTokens` moved to
   * presentation time (`design-system/detail-panel.tsx`), where it already fed
   * the per-row icons. The write path's job is to accept the tokens.
   */
  it('creates a design system with an unresolvable alias, and says nothing about it', async () => {
    const res = await request(t.app)
      .post('/api/design-systems')
      .send({
        name: 'Brand 2026',
        groups: [
          { name: 'Roles', tier: 'semantic', tokens: [{ name: 'x', type: 'color', value: '{missing}' }] },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('brand-2026');
    expect(res.body.data).not.toHaveProperty('warnings');
  });

  it('lists, gets, and full-replaces groups on update', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });

    const list = await request(t.app).get('/api/design-systems');
    expect(list.status).toBe(200);
    expect(list.body.data.map((d: { slug: string }) => d.slug)).toContain('brand');

    const get = await request(t.app).get('/api/design-systems/brand');
    expect(get.status).toBe(200);
    expect(get.body.data.groups).toHaveLength(2);

    const patched = await request(t.app)
      .patch('/api/design-systems/brand')
      .send({ groups: [{ name: 'Only', tier: 'primitive', tokens: [] }] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.groups).toHaveLength(1);
    expect(patched.body.data.groups[0].name).toBe('Only');
  });

  it('ui-view accepts designSystemSlug (incl. a dangling one) and round-trips it', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });

    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });
    expect(view.status).toBe(201);
    expect(view.body.data.designSystemSlug).toBe('brand');

    // dangling reference is allowed (no FK) — write succeeds, value persists
    const dangling = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Ghost', designSystemSlug: 'does-not-exist' });
    expect(dangling.status).toBe(201);
    const gv = await request(t.app).get(`/api/ui-views/${dangling.body.data.slug}`);
    expect(gv.body.data.designSystemSlug).toBe('does-not-exist');
  });

  it('delete reports ui-views that become dangling', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });
    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });

    const del = await request(t.app).delete('/api/design-systems/brand');
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    /**
     * `danglingUiViews` is GONE, and nothing replaced it under another name.
     *
     * It was `design-system`'s own hand-written scan for ui-views pointing at
     * the slug being deleted — a second, per-type answer to a question the
     * declaration already answers: `ui-view.designSystemSlug` is
     * `ref: 'design-system'`, `clearable`, and the host's own dangling-ref
     * check reports it for every type at once. No client ever read this field.
     */
    expect(del.body).not.toHaveProperty('danglingUiViews');
    expect(del.body.brokenReferences).toEqual([]);
    // The view survives, its ref left dangling rather than repaired — the
    // documented behaviour for a `clearable` ref whose target is deleted.
    const gv = await request(t.app).get(`/api/ui-views/${view.body.data.slug}`);
    expect(gv.status).toBe(200);
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
    expect(renamed.body.data.slug).toBe('brand-2026');

    const gv = await request(t.app).get(`/api/ui-views/${view.body.data.slug}`);
    expect(gv.body.data.designSystemSlug).toBe('brand-2026');
  });

  it('ui-view and design-system declare payload version 1, and the snapshot carries designSystemSlug', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand', groups: sampleGroups });
    const view = await request(t.app)
      .post('/api/ui-views')
      .send({ name: 'Profile', designSystemSlug: 'brand' });

    // 0.2.9 (item 13): an integer payload version on the MANIFEST, not a
    // per-serializer semver. The semver was advisory and unenforced; this one
    // is what the upgrade chain acts on.
    expect(t.host.getEntity('ui-view')?.payloadVersion).toBe(1);
    // design-system is at 2 as of tier B PR2: v1 files carry a `description:
    // null` on every token that only ever existed in the file.
    expect(t.host.getEntity('design-system')?.payloadVersion).toBe(2);

    const snap = t.host.snapshot('ui-view', t.rawReader.getEntity('ui-view', view.body.data.slug), t.rawReader) as {
      designSystemSlug: string | null;
    };
    expect(snap.designSystemSlug).toBe('brand');
  });

  /**
   * Still 409 — and it took a declaration to keep it that way.
   *
   * `design-system` derives its slug from `name`, an IDENTITY, so a second
   * "Brand" is the same design system entered twice rather than a new one.
   * Tier E's generic create suffixed every collision (from `ac`'s comment, where
   * the slug is slugified prose and suffixing IS right), which would have turned
   * this into a silent `brand-2` that the author edits while every
   * `<single_element slug="brand"/>` keeps resolving to the stale original.
   * `slugConflict` on the manifest is where the two answers now live; this type
   * takes the default.
   */
  it('refuses a duplicate name rather than minting a second design system', async () => {
    await request(t.app).post('/api/design-systems').send({ name: 'Brand' });
    const dup = await request(t.app).post('/api/design-systems').send({ name: 'Brand' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SLUG_CONFLICT');
  });
});
