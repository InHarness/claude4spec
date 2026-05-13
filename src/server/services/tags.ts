import type Database from 'better-sqlite3';
import type { EntityType, Tag, TagCreateInput, TagUpdateInput } from '../../shared/entities.js';
import { tagSlug } from './slug.js';

const COLOR_PALETTE = [
  '#c45a3b', '#5d7ea2', '#6e8a5f', '#8a6da3',
  '#b6553c', '#7a7368', '#c4a24f', '#4d7e86',
];

interface TagRow {
  id: number;
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export class TagsService {
  constructor(private db: Database.Database) {}

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

  getIdBySlug(slug: string): number | null {
    const row = this.db.prepare(`SELECT id FROM tag WHERE slug = ?`).get(slug) as { id: number } | undefined;
    return row?.id ?? null;
  }

  create(input: TagCreateInput): Tag {
    const slug = tagSlug(input.name);
    if (!slug) throw new Error('tag name produces empty slug');
    const existing = this.db.prepare(`SELECT 1 FROM tag WHERE slug = ?`).get(slug);
    if (existing) throw new DomainError('SLUG_CONFLICT', `tag slug '${slug}' already exists`);
    const color = input.color ?? this.pickColor(slug);
    this.db
      .prepare(
        `INSERT INTO tag (slug, name, color, description) VALUES (?, ?, ?, ?)`
      )
      .run(slug, input.name, color, input.description ?? null);
    return this.getBySlug(slug)!;
  }

  /** Idempotent: returns existing tag if already present. */
  ensure(name: string): Tag {
    const slug = tagSlug(name);
    if (!slug) throw new Error('tag name produces empty slug');
    const existing = this.getBySlug(slug);
    if (existing) return existing;
    return this.create({ name });
  }

  update(slug: string, input: TagUpdateInput): Tag {
    const existing = this.db.prepare(`SELECT * FROM tag WHERE slug = ?`).get(slug) as TagRow | undefined;
    if (!existing) throw new DomainError('NOT_FOUND', `tag '${slug}' not found`);

    const newName = input.name ?? existing.name;
    const newSlug = tagSlug(newName);
    if (newSlug !== slug) {
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
    return this.getBySlug(newSlug)!;
  }

  remove(slug: string): { deleted: true; affectedEntities: number } {
    const existing = this.db.prepare(`SELECT id FROM tag WHERE slug = ?`).get(slug) as { id: number } | undefined;
    if (!existing) throw new DomainError('NOT_FOUND', `tag '${slug}' not found`);
    const affected = (this.db
      .prepare(`SELECT COUNT(*) AS c FROM entity_tag WHERE tag_id = ?`)
      .get(existing.id) as { c: number }).c;
    this.db.prepare(`DELETE FROM tag WHERE id = ?`).run(existing.id);
    return { deleted: true, affectedEntities: affected };
  }

  /** Sets the tag set of an entity to exactly `tagNames` (auto-creating missing tags). */
  assignTags(entityType: EntityType, entityId: number, tagNames: string[]): string[] {
    const names = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))];
    const tx = this.db.transaction(() => {
      const tagIds: number[] = [];
      for (const name of names) {
        const tag = this.ensure(name);
        tagIds.push(this.getIdBySlug(tag.slug)!);
      }
      this.db
        .prepare(`DELETE FROM entity_tag WHERE entity_type = ? AND entity_id = ?`)
        .run(entityType, entityId);
      const insert = this.db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_id, tag_id) VALUES (?, ?, ?)`
      );
      for (const tagId of tagIds) insert.run(entityType, entityId, tagId);
      return names.map((n) => tagSlug(n));
    });
    return tx();
  }

  getEntityTagSlugs(entityType: EntityType, entityId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.slug AS slug
           FROM entity_tag et
           JOIN tag t ON t.id = et.tag_id
          WHERE et.entity_type = ? AND et.entity_id = ?
          ORDER BY t.name`
      )
      .all(entityType, entityId) as Array<{ slug: string }>;
    return rows.map((r) => r.slug);
  }

  private countsByTagSlug(slug?: string): Map<string, Record<string, number>> {
    const sql = `
      SELECT t.slug AS slug, et.entity_type AS entity_type, COUNT(*) AS c
        FROM entity_tag et
        JOIN tag t ON t.id = et.tag_id
       ${slug ? `WHERE t.slug = ?` : ``}
       GROUP BY t.slug, et.entity_type
    `;
    const rows = (slug ? this.db.prepare(sql).all(slug) : this.db.prepare(sql).all()) as Array<{
      slug: string;
      entity_type: string;
      c: number;
    }>;
    const out = new Map<string, Record<string, number>>();
    for (const row of rows) {
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
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
