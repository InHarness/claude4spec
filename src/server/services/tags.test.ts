import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { TagsService } from './tags.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

function fakeHost(activeTypes: string[]): ProjectPluginHost {
  return {
    listEntities: () => activeTypes.map((type) => ({ type }) as never),
  } as unknown as ProjectPluginHost;
}

describe('TagsService counts', () => {
  let db: Database.Database;
  let tags: TagsService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    tags = new TagsService(db);
    tags.setHost(fakeHost(['dto', 'endpoint']));

    tags.create({ name: 'Billing' });
    tags.assignTags('dto', 'invoice', ['Billing']);
    tags.assignTags('endpoint', 'get-invoice', ['Billing']);
    // Simulate a plugin that got disabled after these rows were written —
    // 'database-table' is a valid RawEntityType but NOT in the active set.
    tags.assignTags('database-table', 'invoices', ['Billing']);
  });

  it('reports counts only for currently-active entity types', () => {
    const tag = tags.getBySlug('billing');
    expect(tag?.counts).toEqual({ dto: 1, endpoint: 1 });
    expect(tag?.counts['database-table']).toBeUndefined();
  });

  it('falls back to unfiltered counts before host is wired (early boot)', () => {
    const unwired = new TagsService(db);
    const tag = unwired.getBySlug('billing');
    expect(tag?.counts).toEqual({ dto: 1, endpoint: 1, 'database-table': 1 });
  });

  it('removeEntityTag drops one tag without touching the entity\'s other tags', () => {
    tags.create({ name: 'Urgent' });
    tags.assignTags('dto', 'invoice', ['Billing', 'Urgent']);
    expect(tags.getEntityTagSlugs('dto', 'invoice').sort()).toEqual(['billing', 'urgent']);

    const remaining = tags.removeEntityTag('dto', 'invoice', 'billing');

    expect(remaining).toEqual(['urgent']);
    expect(tags.getEntityTagSlugs('dto', 'invoice')).toEqual(['urgent']);
  });

  it('removeEntityTag is a no-op when the tag was never assigned', () => {
    const remaining = tags.removeEntityTag('dto', 'invoice', 'not-a-real-tag');
    expect(remaining).toEqual(['billing']);
  });
});

describe('TagsService — tag materialized by an entity save', () => {
  it('[entity:dto-detail] a new tag name on an entity save creates the tag without a colour; an explicit create keeps the palette pick', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tags = new TagsService(db);
    tags.setHost(fakeHost(['dto']));

    // The DTO detail page adds a new name to the entity's draft; the tag comes
    // into being only when the entity is saved (`assignTags` → `ensure`).
    expect(tags.getBySlug('auth-layer')).toBeNull();
    const assigned = tags.assignTags('dto', 'user-response', ['Auth Layer']);
    expect(assigned).toEqual(['auth-layer']);
    const created = tags.getBySlug('auth-layer');
    expect(created?.name).toBe('Auth Layer');
    expect(created?.color).toBeNull();

    // A tag created explicitly (tag management) still gets a palette colour.
    const explicit = tags.create({ name: 'Billing' });
    expect(explicit.color).toMatch(/\S/);
  });
});
