/**
 * M34/L11: `tagsService` — the only read+write plugin-facing service (owned by
 * M18). Mirrors the backend `tag_entity`/`untag_entity`/`create_tag`
 * operations. Re-exported through `@c4s/plugin-runtime` alongside `useTags`/
 * `useEntityTags`/`useAssignTags`/`useRemoveEntityTag`/`useCreateTag`
 * (`../hooks/useTags.js`).
 */

import { tagsApi, ApiError } from '../lib/api.js';
import type { EntityType, Tag, TagListItem } from '../../shared/entities.js';

/**
 * `create` for a name resolving to an existing slug is a no-op, matching the
 * backend's auto-create-by-slug behavior (`TagsService.ensure`) — `POST
 * /api/tags` itself throws SLUG_CONFLICT (correct for the tag-management UI),
 * so idempotency is implemented here instead of loosening that route.
 */
export async function createTagIdempotent(name: string): Promise<Tag> {
  try {
    return await tagsApi.create({ name });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'SLUG_CONFLICT') {
      const existing = (await tagsApi.list()).find((t) => t.name === name || t.slug === name);
      if (existing) return existing;
    }
    throw err;
  }
}

export const tagsService = {
  list(): Promise<TagListItem[]> {
    return tagsApi.list();
  },
  getEntityTagSlugs(type: EntityType, slug: string): Promise<string[]> {
    return tagsApi.getEntityTags(type, slug);
  },
  /** Idempotent: safe to call repeatedly with the same desired tag set. */
  assign(type: EntityType, slug: string, tags: string[]): Promise<string[]> {
    return tagsApi.assign(type, slug, tags);
  },
  /** Removes ONE tag without touching the entity's other tags. */
  remove(type: EntityType, slug: string, tagSlug: string): Promise<string[]> {
    return tagsApi.removeEntityTag(type, slug, tagSlug);
  },
  create: createTagIdempotent,
};

export type TagsServiceSingleton = typeof tagsService;
