import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import { TAG_TOOL_RECORDS } from '../../../tests/helpers/tag-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { declaredParams } from '../../../tests/helpers/read-tool-records.js';
import { createReferenceToolsServer, type ReferenceToolsDeps } from './reference-tools.js';
import { TagsService } from '../services/tags.js';
import { httpStatusForCode } from '../operations/error-codes.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import type { EntityStore } from '../services/entity-store.js';
import type { ReferencesService } from '../services/references.js';

/**
 * 2.1.26 — the five M18 tag write tools on `reference-tools` as their re-rendered
 * `mcp-tool` records declare them (name, description, parameters, no hints) and
 * as their `logic` states them, plus the M18 / M13 sections the window changed:
 * a type unknown or inactive is `400 VALIDATION`, a missing entity `404
 * NOT_FOUND` — the dedicated `INACTIVE_TYPE` / `ENTITY_NOT_FOUND` of the tag
 * doors are gone — and `create_tag` takes no slug, it derives one.
 *
 * The world: a real `TagsService` over a real project database; a host with
 * `widget` active (entities `w1`, `w2`) and `ghost` available but NOT active in
 * this project; an entity store, a reference service and an emitter that record
 * what they were asked to do.
 */

function mod(type: string): BackendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    pathPrefix: `/${type}s`,
    systemPrompt: { roleNoun: type },
  } as BackendModule;
}

const WIDGET = mod('widget');
const GHOST = mod('ghost');
const EXISTING = new Set(['widget/w1', 'widget/w2', 'ghost/g1']);

const host = {
  getEntity: (type: string) => (type === 'widget' ? WIDGET : null),
  getAvailable: (type: string) => (type === 'widget' ? WIDGET : type === 'ghost' ? GHOST : null),
  isActive: (type: string) => type === 'widget',
  listEntities: () => [WIDGET],
  listAvailable: () => [WIDGET, GHOST],
  entityExists: (type: string, slug: string) => EXISTING.has(`${type}/${slug}`),
} as unknown as ProjectPluginHost;

let db: Database.Database;
let tags: TagsService;
let persisted: string[];
let tagsJsonWrites: number;
let broadcasts: Array<Record<string, unknown>>;
let propagations: Array<[string, string]>;
let deps: ReferenceToolsDeps;

beforeEach(() => {
  db = createTestDb();
  persisted = [];
  tagsJsonWrites = 0;
  broadcasts = [];
  propagations = [];
  const store = {
    persist: (type: string, slug: string) => void persisted.push(`${type}/${slug}`),
    persistTags: () => void tagsJsonWrites++,
  } as unknown as EntityStore;
  tags = new TagsService(db);
  tags.setEntityStore(store);
  tags.setHost(host);
  deps = {
    pluginHost: host,
    tagsService: tags,
    referencesService: {
      propagateTagSlugChange: async (from: string, to: string) => void propagations.push([from, to]),
    } as unknown as ReferencesService,
    discovery: {} as never,
    ws: { broadcast: (e) => void broadcasts.push(e as unknown as Record<string, unknown>) },
    entityStore: store,
  };
});

const declared = (name: string) => createReferenceToolsServer(deps).tools.find((t) => t.name === name);

async function call(name: string, args: Record<string, unknown>) {
  const tool = declared(name)!;
  const res = (await tool.handler(args, {})) as { content: Array<{ text: string }>; isError?: boolean };
  return { isError: res.isError === true, body: JSON.parse(res.content[0]!.text) as Record<string, unknown> };
}

const tagRow = (slug: string) =>
  db.prepare(`SELECT slug, name, color, description FROM tag WHERE slug = ?`).get(slug) as
    | { slug: string; name: string; color: string | null; description: string | null }
    | undefined;
const assigned = (type: string, slug: string) => tags.getEntityTagSlugs(type as never, slug);
const seedTag = (slug: string, name = slug, color: string | null = '#123456', description: string | null = 'd') =>
  db.prepare(`INSERT INTO tag (slug, name, color, description) VALUES (?, ?, ?, ?)`).run(slug, name, color, description);
const seedAssign = (type: string, slug: string, tag: string) =>
  db.prepare(`INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?, ?, ?)`).run(type, slug, tag);

describe('reference-tools — the M18 tag write tools as their 2.1.26 records declare them', () => {
  it('[entity:reference-tools-create-tag] create_tag: the record\'s contract (no `slug` parameter); the slug derived from `name`, `{ slug, name }` returned, palette colour when none is given, reserved slug → VALIDATION, taken slug → SLUG_CONFLICT, the registry written then the tag announced', async () => {
    const tool = declared('create_tag');
    expectToolMatchesToolRecord(tool, TAG_TOOL_RECORDS['reference-tools-create-tag']!);
    expect(declaredParams(tool!).map((p) => p.name)).not.toContain('slug');

    // An explicit slug is not part of the contract: it is not read.
    const made = await call('create_tag', { name: 'Auth Layer', slug: 'ignored-slug' });
    expect(made.isError).toBe(false);
    expect(made.body).toEqual({ slug: 'auth-layer', name: 'Auth Layer' });
    expect(tagRow('ignored-slug')).toBeUndefined();
    // Without `color`, the palette picks one.
    expect(tagRow('auth-layer')!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(tagsJsonWrites).toBeGreaterThan(0);
    expect(broadcasts).toEqual([{ kind: 'tag:changed', slug: 'auth-layer', action: 'create' }]);

    const colored = await call('create_tag', { name: 'Billing', color: '#4A90D9', description: 'money' });
    expect(colored.body).toEqual({ slug: 'billing', name: 'Billing' });
    expect(tagRow('billing')).toMatchObject({ color: '#4A90D9', description: 'money' });

    const reserved = await call('create_tag', { name: 'List' });
    expect(reserved.isError).toBe(true);
    expect(reserved.body.code).toBe('VALIDATION');

    const taken = await call('create_tag', { name: 'auth layer' });
    expect(taken.isError).toBe(true);
    expect(taken.body.code).toBe('SLUG_CONFLICT');

    const empty = await call('create_tag', { name: '   ' });
    expect(empty.isError).toBe(true);
    expect(empty.body.code).toBe('VALIDATION');
  });

  it('[entity:reference-tools-update-tag] update_tag: the record\'s contract; unknown tag → NOT_FOUND, a new name\'s slug reserved → VALIDATION or taken → SLUG_CONFLICT, `null` clears colour/description and an omitted field stays, a rename re-writes the tagged entity files and re-points the pages, `{ slug, updated: true }` with the new slug, the tag announced', async () => {
    expectToolMatchesToolRecord(declared('update_tag'), TAG_TOOL_RECORDS['reference-tools-update-tag']!);

    const missing = await call('update_tag', { slug: 'nope', data: { name: 'X' } });
    expect(missing.isError).toBe(true);
    expect(missing.body.code).toBe('NOT_FOUND');

    seedTag('auth', 'auth', '#111111', 'who you are');
    seedTag('billing');
    seedAssign('widget', 'w1', 'auth');

    expect((await call('update_tag', { slug: 'auth', data: { name: 'List' } })).body.code).toBe('VALIDATION');
    expect((await call('update_tag', { slug: 'auth', data: { name: 'Billing' } })).body.code).toBe('SLUG_CONFLICT');

    const cleared = await call('update_tag', { slug: 'auth', data: { color: null } });
    expect(cleared).toEqual({ isError: false, body: { slug: 'auth', updated: true } });
    expect(tagRow('auth')).toMatchObject({ color: null, description: 'who you are' });
    expect(persisted).toEqual([]);
    expect(propagations).toEqual([]);

    broadcasts.length = 0;
    const renamed = await call('update_tag', { slug: 'auth', data: { name: 'Identity', description: null } });
    expect(renamed).toEqual({ isError: false, body: { slug: 'identity', updated: true } });
    expect(tagRow('auth')).toBeUndefined();
    expect(tagRow('identity')).toMatchObject({ name: 'Identity', description: null });
    expect(assigned('widget', 'w1')).toEqual(['identity']);
    expect(persisted).toEqual(['widget/w1']);
    expect(propagations).toEqual([['auth', 'identity']]);
    expect(broadcasts).toEqual([{ kind: 'tag:changed', slug: 'identity', action: 'update' }]);
  });

  it('[entity:reference-tools-delete-tag] delete_tag: the record\'s contract; unknown tag → NOT_FOUND, also on a repeat; every assignment removed in cascade, the affected entity files re-written, `{ deleted: true, affectedEntities }`, the tag announced', async () => {
    expectToolMatchesToolRecord(declared('delete_tag'), TAG_TOOL_RECORDS['reference-tools-delete-tag']!);

    expect((await call('delete_tag', { slug: 'nope' })).body.code).toBe('NOT_FOUND');

    seedTag('auth');
    seedAssign('widget', 'w1', 'auth');
    seedAssign('widget', 'w2', 'auth');
    const gone = await call('delete_tag', { slug: 'auth' });
    expect(gone).toEqual({ isError: false, body: { deleted: true, affectedEntities: 2 } });
    expect(tagRow('auth')).toBeUndefined();
    expect(assigned('widget', 'w1')).toEqual([]);
    expect(assigned('widget', 'w2')).toEqual([]);
    expect([...persisted].sort()).toEqual(['widget/w1', 'widget/w2']);
    expect(broadcasts).toEqual([{ kind: 'tag:changed', slug: 'auth', action: 'delete' }]);

    const again = await call('delete_tag', { slug: 'auth' });
    expect(again.isError).toBe(true);
    expect(again.body.code).toBe('NOT_FOUND');
  });

  it('[entity:reference-tools-tag-entity] tag_entity: the record\'s contract; unknown or inactive type → VALIDATION, missing entity → NOT_FOUND (no INACTIVE_TYPE / ENTITY_NOT_FOUND); names turned into slugs, a missing tag created without a colour, the set set to the union, the entity file re-written, `{ tagged: true, addedCount }` counting only new tags, the entity and each added tag announced', async () => {
    expectToolMatchesToolRecord(declared('tag_entity'), TAG_TOOL_RECORDS['reference-tools-tag-entity']!);

    for (const type of ['nope', 'ghost']) {
      const refused = await call('tag_entity', { type, slug: type === 'ghost' ? 'g1' : 'x', tags: ['a'] });
      expect(refused.isError, type).toBe(true);
      expect(refused.body.code, type).toBe('VALIDATION');
    }
    const missing = await call('tag_entity', { type: 'widget', slug: 'no-such', tags: ['a'] });
    expect(missing.isError).toBe(true);
    expect(missing.body.code).toBe('NOT_FOUND');
    expect(persisted).toEqual([]);

    seedTag('core');
    seedAssign('widget', 'w1', 'core');
    const tagged = await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['Auth Layer', 'core'] });
    expect(tagged).toEqual({ isError: false, body: { tagged: true, addedCount: 1 } });
    expect(assigned('widget', 'w1').sort()).toEqual(['auth-layer', 'core']);
    expect(tagRow('auth-layer')).toEqual({ slug: 'auth-layer', name: 'Auth Layer', color: null, description: null });
    expect(persisted).toEqual(['widget/w1']);
    expect(broadcasts).toEqual([
      { kind: 'entity:changed', entityType: 'widget', slug: 'w1', action: 'update' },
      { kind: 'tag:changed', slug: 'auth-layer', action: 'update' },
    ]);

    // A repeat is a no-op, not a refusal.
    broadcasts.length = 0;
    const repeat = await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['auth-layer', 'Auth Layer'] });
    expect(repeat).toEqual({ isError: false, body: { tagged: true, addedCount: 0 } });
    expect(assigned('widget', 'w1').sort()).toEqual(['auth-layer', 'core']);
    expect(broadcasts).toEqual([{ kind: 'entity:changed', entityType: 'widget', slug: 'w1', action: 'update' }]);
  });

  it('[entity:reference-tools-untag-entity] untag_entity: the record\'s contract; unknown or inactive type → VALIDATION, missing entity → NOT_FOUND; a tag not assigned or not in the registry is no error and not counted, the set set to the rest, the entity file re-written, `{ untagged: true, removedCount }`, the entity and each removed tag announced', async () => {
    expectToolMatchesToolRecord(declared('untag_entity'), TAG_TOOL_RECORDS['reference-tools-untag-entity']!);

    for (const type of ['nope', 'ghost']) {
      const refused = await call('untag_entity', { type, slug: type === 'ghost' ? 'g1' : 'x', tags: ['a'] });
      expect(refused.isError, type).toBe(true);
      expect(refused.body.code, type).toBe('VALIDATION');
    }
    expect((await call('untag_entity', { type: 'widget', slug: 'no-such', tags: ['a'] })).body.code).toBe('NOT_FOUND');

    seedTag('auth');
    seedTag('core');
    seedTag('idle');
    seedAssign('widget', 'w1', 'auth');
    seedAssign('widget', 'w1', 'core');
    const res = await call('untag_entity', { type: 'widget', slug: 'w1', tags: ['auth', 'idle', 'never-defined'] });
    expect(res).toEqual({ isError: false, body: { untagged: true, removedCount: 1 } });
    expect(assigned('widget', 'w1')).toEqual(['core']);
    // The definitions survive — only the assignment went.
    expect(tagRow('auth')).toBeDefined();
    expect(persisted).toEqual(['widget/w1']);
    expect(broadcasts).toEqual([
      { kind: 'entity:changed', entityType: 'widget', slug: 'w1', action: 'update' },
      { kind: 'tag:changed', slug: 'auth', action: 'update' },
    ]);
  });
});

describe('M18 / M13 — the tag sections the 2.1.26 window changed', () => {
  it('[section:ais9x109] tag assignment: tag_entity writes the entity file\'s tags[] (write path), is idempotent, auto-creates a missing tag with name = slug, no colour, no description; untag_entity removes from tags[]; an inactive type is refused with 400 VALIDATION; getEntityTagSlugs reads one entity\'s tag slugs', async () => {
    const first = await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['auth'] });
    expect(first.body).toEqual({ tagged: true, addedCount: 1 });
    expect(persisted).toEqual(['widget/w1']);
    expect(tagRow('auth')).toEqual({ slug: 'auth', name: 'auth', color: null, description: null });
    expect((await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['auth'] })).body).toEqual({ tagged: true, addedCount: 0 });
    expect(tags.getEntityTagSlugs('widget' as never, 'w1')).toEqual(['auth']);
    // Cross-entity: the same tag on a second entity of an active type.
    await call('tag_entity', { type: 'widget', slug: 'w2', tags: ['auth'] });
    expect(tags.getEntityTagSlugs('widget' as never, 'w2')).toEqual(['auth']);

    const inactive = await call('tag_entity', { type: 'ghost', slug: 'g1', tags: ['auth'] });
    expect(inactive.body.code).toBe('VALIDATION');
    expect(httpStatusForCode(String(inactive.body.code))).toBe(400);
    expect(assigned('ghost', 'g1')).toEqual([]);

    persisted.length = 0;
    expect((await call('untag_entity', { type: 'widget', slug: 'w1', tags: ['auth'] })).body).toEqual({ untagged: true, removedCount: 1 });
    expect(persisted).toEqual(['widget/w1']);
    expect(tags.getEntityTagSlugs('widget' as never, 'w1')).toEqual([]);
  });

  it('[section:0ljsk5jr] edge cases: a taken tag slug → 409 SLUG_CONFLICT; tag_entity on a missing entity → 404 NOT_FOUND and on an inactive type → 400 VALIDATION; deleting a tag cascades its assignments; auto-create gives name = slug, no colour, no description; a tag with no entities stays; an inactive type\'s counter is left out', async () => {
    await call('create_tag', { name: 'Auth' });
    const dup = await call('create_tag', { name: 'auth' });
    expect(dup.body.code).toBe('SLUG_CONFLICT');
    expect(httpStatusForCode('SLUG_CONFLICT')).toBe(409);

    const missing = await call('tag_entity', { type: 'widget', slug: 'no-such', tags: ['auth'] });
    expect(missing.body.code).toBe('NOT_FOUND');
    expect(httpStatusForCode(String(missing.body.code))).toBe(404);
    const inactive = await call('tag_entity', { type: 'ghost', slug: 'g1', tags: ['auth'] });
    expect(inactive.body.code).toBe('VALIDATION');
    expect(httpStatusForCode(String(inactive.body.code))).toBe(400);
    for (const res of [missing, inactive]) {
      expect(res.body.code).not.toBe('ENTITY_NOT_FOUND');
      expect(res.body.code).not.toBe('INACTIVE_TYPE');
    }

    await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['fresh'] });
    expect(tagRow('fresh')).toEqual({ slug: 'fresh', name: 'fresh', color: null, description: null });

    await call('tag_entity', { type: 'widget', slug: 'w2', tags: ['auth'] });
    expect((await call('delete_tag', { slug: 'auth' })).body).toEqual({ deleted: true, affectedEntities: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM entity_tag WHERE tag_slug = 'auth'`).get()).toEqual({ n: 0 });

    // A tag with no entities is not auto-deleted.
    await call('untag_entity', { type: 'widget', slug: 'w1', tags: ['fresh'] });
    expect(tagRow('fresh')).toBeDefined();

    // An inactive type's counter is left out of the counts map.
    seedTag('mixed');
    seedAssign('widget', 'w1', 'mixed');
    seedAssign('ghost', 'g1', 'mixed');
    expect(tags.getBySlug('mixed')!.counts).toEqual({ widget: 1 });
  });

  it('[section:m18acc00] acceptance: create/update/delete_tag write the tag registry (tags.json); tag_entity/untag_entity write the entity file\'s tags[]; tag_entity is idempotent and auto-creates name = slug, no colour, no description; tag_entity on an inactive type returns 400 VALIDATION; a slug rename re-writes the entity files and propagates to the pages', async () => {
    tagsJsonWrites = 0;
    await call('create_tag', { name: 'Auth' });
    expect(tagsJsonWrites).toBe(1);
    await call('update_tag', { slug: 'auth', data: { color: '#222222' } });
    expect(tagsJsonWrites).toBe(2);

    persisted.length = 0;
    await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['auth', 'auto'] });
    expect(persisted).toEqual(['widget/w1']);
    expect(tagRow('auto')).toEqual({ slug: 'auto', name: 'auto', color: null, description: null });
    expect((await call('tag_entity', { type: 'widget', slug: 'w1', tags: ['auth'] })).body).toEqual({ tagged: true, addedCount: 0 });

    const inactive = await call('tag_entity', { type: 'ghost', slug: 'g1', tags: ['auth'] });
    expect(inactive.body.code).toBe('VALIDATION');
    expect(httpStatusForCode('VALIDATION')).toBe(400);

    persisted.length = 0;
    await call('untag_entity', { type: 'widget', slug: 'w1', tags: ['auto'] });
    expect(persisted).toEqual(['widget/w1']);

    persisted.length = 0;
    const renamed = await call('update_tag', { slug: 'auth', data: { name: 'Identity' } });
    expect(renamed.body).toEqual({ slug: 'identity', updated: true });
    expect(persisted).toEqual(['widget/w1']);
    expect(propagations).toEqual([['auth', 'identity']]);
    expect(assigned('widget', 'w1')).toEqual(['identity']);

    const writesBeforeDelete = tagsJsonWrites;
    await call('delete_tag', { slug: 'identity' });
    expect(tagsJsonWrites).toBe(writesBeforeDelete + 1);
  });
});
