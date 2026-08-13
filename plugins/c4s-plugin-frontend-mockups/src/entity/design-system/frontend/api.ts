import type {
  DesignSystem,
  DesignSystemCreateInput,
  DesignSystemListQuery,
  DesignSystemUpdateInput,
} from '../../../types.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';

/**
 * What `GET /api/design-systems` actually answers with — the L9
 * `element_list_item` view, which is NARROWER than `DesignSystem`.
 *
 * `groups[]` (every token, with its resolved value per mode) is the expensive
 * half of this entity, and the list page only rendered two numbers from it. The
 * declared list view carries those two numbers directly; see `UiViewListItem`
 * for the same note.
 */
export type DesignSystemListItem = Pick<
  DesignSystem,
  'slug' | 'title' | 'description' | 'tags' | 'createdAt' | 'updatedAt'
> & { type: 'design-system'; groupCount: number; tokenCount: number };

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
