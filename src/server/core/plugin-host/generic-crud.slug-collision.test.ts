/**
 * M13 `x2nr826t` / `z7l89jhf` (2.1.57) — the slug-collision policy is an
 * identity slot, `slugCollision?: 'error' | 'suffix'`, read by the generic
 * write door when the slug DERIVED from `slugPattern` is already taken:
 *
 *   - omitted → `'error'` → `SLUG_CONFLICT`;
 *   - `'error'` → `SLUG_CONFLICT`;
 *   - `'suffix'` → a disambiguating `-2`, `-3`;
 *   - an EXPLICIT slug is outside the declaration: its collision is always
 *     `SLUG_CONFLICT`, even for a `'suffix'` type.
 *
 * The harness is the one `generic-crud.normalize.test.ts` uses: a real
 * projection in `:memory:`, the reader reading it back, the side effects
 * (tags, file, version capture) stubbed.
 */

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection } from '../../db/projection.js';
import type { WritableModule } from '../../db/projection-write.js';
import { genericCreate, type GenericCrudDeps } from './generic-crud.js';

function moduleWith(policy: 'error' | 'suffix' | undefined): WritableModule {
  return {
    type: 'note',
    payloadVersion: 1,
    slugPattern: [{ op: 'slugify', field: 'title' }],
    ...(policy ? { slugCollision: policy } : {}),
    data: {
      schema: {
        title: { type: 'string', required: true, maxLength: 200 },
        updatedAt: { type: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
      },
    },
  } as unknown as WritableModule;
}

function harness(policy: 'error' | 'suffix' | undefined) {
  const note = moduleWith(policy);
  const db = new Database(':memory:');
  applyProjection(db, [note]);
  const row = (slug: string) =>
    db.prepare('SELECT slug, title FROM note WHERE slug = ?').get(slug) as
      | { slug: string; title: string }
      | undefined;
  const deps = {
    host: { getEntity: (t: string) => (t === 'note' ? note : undefined) },
    reader: {
      getEntity: (_t: string, slug: string) => {
        const found = row(slug);
        return found ? { slug: found.slug, type: 'note', data: found, tags: [] } : null;
      },
    },
    tags: { assignTags: vi.fn() },
    store: { persist: vi.fn() },
    references: {},
    projection: { db, versions: { captureEntitySnapshot: vi.fn() } },
  } as unknown as GenericCrudDeps;
  const create = (input: Record<string, unknown>) => genericCreate(deps, 'note', input, 'user');
  return { create, row };
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
};

describe('[section:x2nr826t] slug collision — policy declared per type, error by default', () => {
  it('a type that omits slugCollision refuses a derived collision with SLUG_CONFLICT', () => {
    const t = harness(undefined);
    expect(t.create({ title: 'Order Form' }).slug).toBe('order-form');
    expect(codeOf(() => t.create({ title: 'Order Form' }))).toBe('SLUG_CONFLICT');
    expect(t.row('order-form-2')).toBeUndefined();
  });

  it("a type declaring 'error' refuses a derived collision with SLUG_CONFLICT", () => {
    const t = harness('error');
    t.create({ title: 'Order Form' });
    expect(codeOf(() => t.create({ title: 'Order Form' }))).toBe('SLUG_CONFLICT');
  });

  it("a type declaring 'suffix' appends a disambiguating suffix to a derived collision", () => {
    const t = harness('suffix');
    expect(t.create({ title: 'Order Form' }).slug).toBe('order-form');
    expect(t.create({ title: 'Order Form' }).slug).toBe('order-form-2');
    expect(t.create({ title: 'Order Form' }).slug).toBe('order-form-3');
    expect(t.row('order-form-3')?.title).toBe('Order Form');
  });

  it("an explicit slug is outside the declaration: its collision is SLUG_CONFLICT even for a 'suffix' type", () => {
    for (const policy of [undefined, 'error', 'suffix'] as const) {
      const t = harness(policy);
      expect(t.create({ title: 'First', slug: 'pinned' }).slug).toBe('pinned');
      expect(codeOf(() => t.create({ title: 'Second', slug: 'pinned' })), String(policy)).toBe('SLUG_CONFLICT');
      expect(t.row('pinned-2'), String(policy)).toBeUndefined();
    }
  });
});
