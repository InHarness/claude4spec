import type {
  DesignSystem,
  DesignSystemCreateInput,
  DesignSystemListQuery,
  DesignSystemUpdateInput,
} from '../../../types.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';

/**
 * What `GET /api/design-systems` actually answers with.
 *
 * `groupCount`/`tokenCount` used to sit here and were FICTION — nothing produced
 * either, so every row rendered `undefined groups / undefined tokens`. 0.2.55
 * made the first of them real rather than deleting it: `groups` and `modes` are
 * declared `listOverview`, so a LIST read answers with `groupsCount`, counted
 * without reading, while a single-entity GET still carries the arrays.
 *
 * `tokenCount` does NOT come back, and cannot. A token total is nested inside
 * the groups, so the only way to know it is to read every group with every
 * token and its resolved value per mode — which is precisely the payload this
 * narrowing exists to stop shipping. It lives on the detail page, where the
 * groups are loaded anyway.
 */
export type DesignSystemListItem = Pick<
  DesignSystem,
  'slug' | 'title' | 'description' | 'tags' | 'createdAt' | 'updatedAt'
> & { type: 'design-system'; groupsCount: number };

/**
 * Group and token counts for a row, from whichever shape the row arrived in.
 *
 * Two shapes reach the rows and they answer differently, which is the whole
 * reason this is a function: a LIST item carries `groupsCount` and no groups, a
 * full `DesignSystem` (the agent tool renderer hands one over) carries the
 * groups. Tokens are knowable only from the second — `null` says "not knowable
 * here", which a caller must render as absence rather than as zero.
 */
export function countsOf(entity: DesignSystem | DesignSystemListItem): {
  groups: number;
  tokens: number | null;
} {
  if ('groups' in entity && Array.isArray(entity.groups)) {
    return {
      groups: entity.groups.length,
      tokens: entity.groups.reduce((acc, g) => acc + g.tokens.length, 0),
    };
  }
  return { groups: (entity as DesignSystemListItem).groupsCount ?? 0, tokens: null };
}

export const designSystemsApi = {
  async list(query: DesignSystemListQuery = {}): Promise<DesignSystemListItem[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<DesignSystemListItem>(await apiFetch(`/api/design-systems${q}`));
  },

  async get(slug: string): Promise<DesignSystem> {
    return unwrap<DesignSystem>(await apiFetch(`/api/design-systems/${encodeURIComponent(slug)}`));
  },

  async create(input: DesignSystemCreateInput): Promise<DesignSystem> {
    return unwrap<DesignSystem>(
      await apiFetch('/api/design-systems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: DesignSystemUpdateInput): Promise<DesignSystem> {
    return unwrap<DesignSystem>(
      await apiFetch(`/api/design-systems/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await apiFetch(`/api/design-systems/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
};
