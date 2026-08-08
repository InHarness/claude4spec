import type Database from 'better-sqlite3';
import type { EntityType, Tag, TagCreateInput, TagUpdateInput } from '../../shared/entities.js';
import { tagSlug } from './slug.js';
import type { EntityStore } from './entity-store.js';
import type { RawEntityType } from '../discovery/raw-entity-reader.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

const COLOR_PALETTE = [
  '#c45a3b', '#5d7ea2', '#6e8a5f', '#8a6da3',
  '#b6553c', '#7a7368', '#c4a24f', '#4d7e86',
];

interface TagRow {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Slugs a tag may not take, because a route already answers to them.
 *
 * 0.2.13 added `GET /api/tags/list` — the `rest` rendering of `list_tags` —
 * ahead of the long-standing `GET /api/tags/:slug`. Static-before-param is the
 * correct registration order and the route comment says so, but ordering only
 * decides who WINS the collision; nothing stopped the collision from being
 * created. A tag named "List" slugs to `list`, and its detail read then returns
 * the tag LIST envelope with a 200: `createTagIdempotent` (client, on a 409)
 * falls through to `getBySlug`, gets `{ items, total, hasMore }` back with no
 * error, and returns it typed as `Tag` — so the caller attaches a tag whose
 * `slug` and `name` are `undefined` and the first `tag.counts[type]` throws.
 *
 * The release already recognised this collision class for root ids
 * (`RESERVED_ROOT_IDS`, guarding `/api/pages/search`) and guarded exactly one
 * side of it. This is the other side.
 *
 * Write-path only, deliberately: per the same rule this release applied to root
 * ids, a validation introduced in release N does not condemn data written under
 * N-1. A tag already slugged `list` keeps loading and listing, and PATCH is
 * method-scoped so it stays renameable — which is the repair.
 */
const RESERVED_TAG_SLUGS = new Set(['list']);

function assertSlugAvailable(slug: string): void {
  if (!RESERVED_TAG_SLUGS.has(slug)) return;
  throw new DomainError(
    'VALIDATION',
    `tag slug '${slug}' is reserved by the /api/tags/${slug} route`,
    'pick a different name — a tag with this slug could never be read back by slug',
  );
}

export class TagsService {
  constructor(private db: Database.Database) {}

  /**
   * M29: tags.json is the registry source of truth. Wired post-construction
   * (the store is built later in boot). When present, every tag mutation
   * re-writes tags.json; a tag rename also re-persists the entity files whose
   * `tags[]` the FK cascade just moved. Null during early boot / index rebuild.
   */
  private store: EntityStore | null = null;
  setEntityStore(store: EntityStore): void {
    this.store = store;
  }

  /**
   * M34/L11: wired post-construction (host is consolidated after the DB
   * opens). Used to drop counts for entity types that got disabled/unloaded
   * after old `entity_tag` rows were written — `GET /api/tags` should only
   * ever report counts for currently-active types.
   */
  private host: ProjectPluginHost | null = null;
  setHost(host: ProjectPluginHost): void {
    this.host = host;
  }

  list(): Tag[] {
    const rows = this.db.prepare(`SELECT * FROM tag ORDER BY name`).all() as TagRow[];
    const counts = this.countsByTagSlug();
    return rows.map((r) => this.toTag(r, counts));
  }

  getBySlug(slug: string): Tag | null {
    const row = this.db.prepare(`SELECT * FROM tag WHERE slug = ?`).get(slug) as TagRow | undefined;
    if (!row) return null;
    return this.toTag(row, this.countsByTagSlug(slug));
  }

  create(input: TagCreateInput): Tag {
    const slug = tagSlug(input.name);
    if (!slug) throw new Error('tag name produces empty slug');
    assertSlugAvailable(slug);
    return this.insert(slug, input);
  }

  /**
   * The insert, without the reserved-slug check — for {@link ensure} only.
   *
   * `ensure` is not a user creating a tag; it is `assignTags` materializing the
   * `tags[]` an entity FILE already declares, and it runs during indexing. If it
   * refused, an entity written under 0.2.12 with a tag named "List" would fail to
   * index on a rebuild — a validation added in this release condemning data
   * written before it, which is the exact failure the same release fixed for a
   * root id named `search`. The refusal belongs on the path where a human is
   * choosing a name, and nowhere else.
   */
  private insert(slug: string, input: TagCreateInput): Tag {
    const existing = this.db.prepare(`SELECT 1 FROM tag WHERE slug = ?`).get(slug);
    if (existing) throw new DomainError('SLUG_CONFLICT', `tag slug '${slug}' already exists`);
    const color = input.color ?? this.pickColor(slug);
    this.db
      .prepare(
        `INSERT INTO tag (slug, name, color, description) VALUES (?, ?, ?, ?)`
      )
      .run(slug, input.name, color, input.description ?? null);
    this.store?.persistTags();
    return this.getBySlug(slug)!;
  }

  /** M29: re-persist the entity files whose `tags[]` changed due to a tag mutation. */
  private persistEntitiesWithTag(tagSlugValue: string): void {
    if (!this.store) return;
    const rows = this.db
      .prepare(`SELECT DISTINCT entity_type, entity_slug FROM entity_tag WHERE tag_slug = ?`)
      .all(tagSlugValue) as Array<{ entity_type: string; entity_slug: string }>;
    for (const r of rows) {
      try {
        this.store.persist(r.entity_type as RawEntityType, r.entity_slug);
      } catch {
        /* entity may be inactive/missing — skip */
      }
    }
  }

  /** Idempotent: returns existing tag if already present. */
  ensure(name: string): Tag {
    const slug = tagSlug(name);
    if (!slug) throw new Error('tag name produces empty slug');
    const existing = this.getBySlug(slug);
    if (existing) return existing;
    return this.insert(slug, { name });
  }

  update(slug: string, input: TagUpdateInput): Tag {
    const existing = this.db.prepare(`SELECT * FROM tag WHERE slug = ?`).get(slug) as TagRow | undefined;
    if (!existing) throw new DomainError('NOT_FOUND', `tag '${slug}' not found`);

    const newName = input.name ?? existing.name;
    const newSlug = tagSlug(newName);
    if (newSlug !== slug) {
      // Only on a RENAME: a tag already sitting on a reserved slug must stay
      // editable, or the one action that repairs it would be the one refused.
      assertSlugAvailable(newSlug);
      const conflict = this.db.prepare(`SELECT 1 FROM tag WHERE slug = ?`).get(newSlug);
      if (conflict) throw new DomainError('SLUG_CONFLICT', `tag slug '${newSlug}' already exists`);
    }

    this.db
      .prepare(
        `UPDATE tag
           SET slug = ?,
               name = ?,
               color = ?,
               description = ?,
               updated_at = datetime('now')
         WHERE slug = ?`
      )
      .run(
        newSlug,
        newName,
        input.color !== undefined ? input.color : existing.color,
        input.description !== undefined ? input.description : existing.description,
        slug
      );
    this.store?.persistTags();
    // M29: on rename, entity_tag.tag_slug already cascaded (FK ON UPDATE
    // CASCADE) — re-persist the entity files whose tags[] now reference newSlug.
    if (newSlug !== slug) this.persistEntitiesWithTag(newSlug);
    return this.getBySlug(newSlug)!;
  }

  remove(slug: string): { deleted: true; affectedEntities: number } {
    const existing = this.db.prepare(`SELECT slug FROM tag WHERE slug = ?`).get(slug) as { slug: string } | undefined;
    if (!existing) throw new DomainError('NOT_FOUND', `tag '${slug}' not found`);
    // Capture affected entities BEFORE the delete cascades entity_tag away.
    const affectedEntities = this.db
      .prepare(`SELECT DISTINCT entity_type, entity_slug FROM entity_tag WHERE tag_slug = ?`)
      .all(slug) as Array<{ entity_type: string; entity_slug: string }>;
    this.db.prepare(`DELETE FROM tag WHERE slug = ?`).run(slug);
    this.store?.persistTags();
    if (this.store) {
      for (const r of affectedEntities) {
        try {
          this.store.persist(r.entity_type as RawEntityType, r.entity_slug);
        } catch {
          /* skip */
        }
      }
    }
    return { deleted: true, affectedEntities: affectedEntities.length };
  }

  /** Sets the tag set of an entity to exactly `tagNames` (auto-creating missing tags). */
  assignTags(entityType: EntityType, entitySlug: string, tagNames: string[]): string[] {
    const names = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))];
    const tx = this.db.transaction(() => {
      const tagSlugs: string[] = [];
      for (const name of names) {
        const tag = this.ensure(name);
        tagSlugs.push(tag.slug);
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = ? AND entity_slug = ?`)
        .run(entityType, entitySlug);
      const insert = this.db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?, ?, ?)`
      );
      for (const ts of tagSlugs) insert.run(entityType, entitySlug, ts);
      return names.map((n) => tagSlug(n));
    });
    return tx();
  }

  /**
   * M34/L11: remove ONE tag from an entity's set, unlike `assignTags` which
   * fully replaces it — the frontend `tagsService.remove` picker action must
   * not clobber the entity's other tags. No-op if the tag wasn't assigned.
   */
  removeEntityTag(entityType: EntityType, entitySlug: string, tagSlugValue: string): string[] {
    this.db
      .prepare(`DELETE FROM entity_tag WHERE entity_type = ? AND entity_slug = ? AND tag_slug = ?`)
      .run(entityType, entitySlug, tagSlugValue);
    return this.getEntityTagSlugs(entityType, entitySlug);
  }

  getEntityTagSlugs(entityType: EntityType, entitySlug: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.slug AS slug
           FROM entity_tag et
           JOIN tag t ON t.slug = et.tag_slug
          WHERE et.entity_type = ? AND et.entity_slug = ?
          ORDER BY t.name`
      )
      .all(entityType, entitySlug) as Array<{ slug: string }>;
    return rows.map((r) => r.slug);
  }

  private countsByTagSlug(slug?: string): Map<string, Record<string, number>> {
    const sql = `
      SELECT et.tag_slug AS slug, et.entity_type AS entity_type, COUNT(*) AS c
        FROM entity_tag et
       ${slug ? `WHERE et.tag_slug = ?` : ``}
       GROUP BY et.tag_slug, et.entity_type
    `;
    const rows = (slug ? this.db.prepare(sql).all(slug) : this.db.prepare(sql).all()) as Array<{
      slug: string;
      entity_type: string;
      c: number;
    }>;
    // M34/L11: skip entity types no longer active — old entity_tag rows can
    // outlive a disabled/unloaded plugin. `host` is null only during early
    // boot / index rebuild (parity with `store`), in which case fall back to
    // reporting every type unfiltered.
    const activeTypes = this.host ? new Set(this.host.listEntities().map((m) => m.type)) : null;
    const out = new Map<string, Record<string, number>>();
    for (const row of rows) {
      if (activeTypes && !activeTypes.has(row.entity_type)) continue;
      const entry = out.get(row.slug) ?? {};
      entry[row.entity_type] = row.c;
      out.set(row.slug, entry);
    }
    return out;
  }

  private pickColor(slug: string): string {
    let hash = 0;
    for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return COLOR_PALETTE[hash % COLOR_PALETTE.length]!;
  }

  private toTag(row: TagRow, counts: Map<string, Record<string, number>>): Tag {
    return {
      slug: row.slug,
      name: row.name,
      color: row.color,
      description: row.description,
      counts: counts.get(row.slug) ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class DomainError extends Error {
  /**
   * `hint` — the half of the error that says which call would have worked.
   *
   * Optional, and added in 0.2.13 because the CLI's not-found errors lost theirs
   * when the commands moved onto these services: the deleted filesystem readers
   * listed what DID exist, the services answered a bare "not found", and the
   * agent on the other end had nothing to correct itself with. The catalog's own
   * contract says `NOT_FOUND` carries alternatives — this is where a service
   * puts them. `routes/errors.ts` forwards it verbatim.
   */
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
    this.name = 'DomainError';
  }
}
