import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import type { TagListItem as HostTagListItem } from '../../shared/entities.js';
import type { TagListItem } from '../../plugin-types/plugin-runtime.js';
import type { Tag, TagPickerProps } from '../../plugin-types/ui.js';

/**
 * DTO `tag-list-item` (M18) — one item of `GET /api/tags`, the read-shape
 * `tagsService` / `useTags()` hand to a plugin. Fields (unchanged in 2.1.28):
 *
 * | field         | type                     | required |
 * | ------------- | ------------------------ | -------- |
 * | `slug`        | `string`                 | yes      |
 * | `name`        | `string`                 | yes      |
 * | `color`       | `string \| null`         | no       |
 * | `description` | `string \| null`         | no       |
 * | `counts`      | `Record<string, number>` | yes      |
 *
 * The route always emits `color` / `description` (`null` when unset), so the
 * published type carries them as present-and-nullable; a non-required field is
 * satisfied by that. The type-level half is also compiled by `npm run
 * typecheck` from `src/client/runtime/tag-list-item.types.test.ts`.
 */

describe('GET /api/tags — the tag-list-item DTO', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[entity:tag-list-item] every item carries slug, name, color, description and counts with the DTO types', async () => {
    await request(t.app).post('/api/tags').send({ name: 'Billing', color: '#4A90D9', description: 'Payment flows' }).expect(201);
    await request(t.app).post('/api/tags').send({ name: 'Auth' }).expect(201);
    // A create picks a palette colour; clearing it is how a tag gets `color: null`.
    await request(t.app).patch('/api/tags/auth').send({ color: null }).expect(200);

    const res = await request(t.app).get('/api/tags').expect(200);
    const items = res.body.tags as Record<string, unknown>[];
    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(typeof item.slug).toBe('string');
      expect(item.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(typeof item.name).toBe('string');
      expect(item.color === null || typeof item.color === 'string').toBe(true);
      expect(item.description === null || typeof item.description === 'string').toBe(true);
      // `counts`: a map type → number, one key per ACTIVE entity type.
      expect(item.counts).toBeTypeOf('object');
      expect(item.counts).not.toBeNull();
      const counts = item.counts as Record<string, unknown>;
      for (const [type, n] of Object.entries(counts)) {
        expect(typeof type).toBe('string');
        expect(Number.isInteger(n)).toBe(true);
      }
    }

    const billing = items.find((i) => i.slug === 'billing')!;
    expect(billing).toMatchObject({ name: 'Billing', color: '#4A90D9', description: 'Payment flows' });
    const auth = items.find((i) => i.slug === 'auth')!;
    expect(auth).toMatchObject({ name: 'Auth', color: null, description: null });
  });

  it('[entity:tag-list-item] the type is assignable without a cast to the /ui Tag and to the TagPicker allTags item', () => {
    type PickerItem = TagPickerProps['allTags'][number];
    // 2.1.42 — `allTags` is the public `Tag[]`, not an inline shape.
    expectTypeOf<TagPickerProps['allTags']>().toEqualTypeOf<Tag[]>();

    // Field set and types, as the DTO states them.
    expectTypeOf<TagListItem['slug']>().toEqualTypeOf<string>();
    expectTypeOf<TagListItem['name']>().toEqualTypeOf<string>();
    expectTypeOf<TagListItem['color']>().toEqualTypeOf<string | null>();
    expectTypeOf<TagListItem['description']>().toEqualTypeOf<string | null>();
    expectTypeOf<TagListItem['counts']>().toEqualTypeOf<Record<string, number>>();
    expectTypeOf<keyof TagListItem>().toEqualTypeOf<'slug' | 'name' | 'color' | 'description' | 'counts'>();

    // Published and host shapes both reach the kit as they are.
    expectTypeOf<TagListItem>().toMatchTypeOf<Tag>();
    expectTypeOf<TagListItem>().toMatchTypeOf<PickerItem>();
    expectTypeOf<HostTagListItem>().toMatchTypeOf<TagListItem>();
    expectTypeOf<HostTagListItem>().toMatchTypeOf<Tag>();
    expectTypeOf<HostTagListItem>().toMatchTypeOf<PickerItem>();

    // And by plain assignment, the way a plugin writes it.
    const item: TagListItem = { slug: 'billing', name: 'Billing', color: null, description: null, counts: {} };
    const asTag: Tag = item;
    const asPicker: PickerItem[] = [item];
    expect(asTag.slug).toBe('billing');
    expect(asPicker[0]!.name).toBe('Billing');
  });
});

/**
 * 2.1.42 (M18) — the REST tag-definition mutations broadcast `tag:changed` to
 * the project room, the same event the MCP tools emit; a refusal emits nothing.
 */
describe('POST/PATCH/DELETE /api/tags — tag:changed broadcast', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  const tagEvents = () =>
    t.broadcasts.filter((e) => (e as { kind?: string }).kind === 'tag:changed');

  it('POST emits one tag:changed { action: create } with the created slug', async () => {
    await request(t.app).post('/api/tags').send({ name: 'Auth Layer' }).expect(201);
    expect(tagEvents()).toEqual([{ kind: 'tag:changed', slug: 'auth-layer', action: 'create' }]);
  });

  it('PATCH without rename emits one tag:changed { action: update } with the same slug', async () => {
    await request(t.app).post('/api/tags').send({ name: 'Auth' }).expect(201);
    t.broadcasts.length = 0;
    await request(t.app).patch('/api/tags/auth').send({ color: '#123456' }).expect(200);
    expect(tagEvents()).toEqual([{ kind: 'tag:changed', slug: 'auth', action: 'update' }]);
  });

  it('PATCH with a slug-changing rename emits the NEW slug', async () => {
    await request(t.app).post('/api/tags').send({ name: 'Auth' }).expect(201);
    t.broadcasts.length = 0;
    await request(t.app).patch('/api/tags/auth').send({ name: 'Identity' }).expect(200);
    expect(tagEvents()).toEqual([{ kind: 'tag:changed', slug: 'identity', action: 'update' }]);
  });

  it('DELETE emits one tag:changed { action: delete } with the deleted slug', async () => {
    await request(t.app).post('/api/tags').send({ name: 'Auth' }).expect(201);
    t.broadcasts.length = 0;
    await request(t.app).delete('/api/tags/auth').expect(200);
    expect(tagEvents()).toEqual([{ kind: 'tag:changed', slug: 'auth', action: 'delete' }]);
  });

  it('refusals (SLUG_CONFLICT, NOT_FOUND, VALIDATION) emit nothing', async () => {
    await request(t.app).post('/api/tags').send({ name: 'Auth' }).expect(201);
    await request(t.app).post('/api/tags').send({ name: 'Billing' }).expect(201);
    t.broadcasts.length = 0;

    // SLUG_CONFLICT — create and rename onto an existing slug.
    const c1 = await request(t.app).post('/api/tags').send({ name: 'auth' });
    expect(c1.body.error?.code).toBe('SLUG_CONFLICT');
    const c2 = await request(t.app).patch('/api/tags/auth').send({ name: 'Billing' });
    expect(c2.body.error?.code).toBe('SLUG_CONFLICT');

    // NOT_FOUND — update and delete of a missing tag.
    const n1 = await request(t.app).patch('/api/tags/missing').send({ color: '#000000' });
    expect(n1.body.error?.code).toBe('NOT_FOUND');
    const n2 = await request(t.app).delete('/api/tags/missing');
    expect(n2.body.error?.code).toBe('NOT_FOUND');

    // VALIDATION — empty name on create, reserved slug on create and rename.
    const v1 = await request(t.app).post('/api/tags').send({ name: '' });
    expect(v1.body.error?.code).toBe('VALIDATION');
    const v2 = await request(t.app).post('/api/tags').send({ name: 'list' });
    expect(v2.body.error?.code).toBe('VALIDATION');
    const v3 = await request(t.app).patch('/api/tags/auth').send({ name: 'List' });
    expect(v3.body.error?.code).toBe('VALIDATION');

    expect(tagEvents()).toEqual([]);
  });
});
