import type {
  UiView,
  UiViewCreateInput,
  UiViewListQuery,
  UiViewUpdateInput,
} from '../../../types.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';

/**
 * What `GET /api/ui-views` actually answers with — the L9 `element_list_item`
 * view, which is NARROWER than `UiView`.
 *
 * The retired `uiViewsRouter` selected whole rows, so the list and the detail
 * happened to be the same shape and the client typed both as `UiView`. The
 * generated router serves the declared list view instead, and that view carries
 * `paramCount` rather than the `params[]` array — cheaper for a list, and the
 * list page only ever rendered the count. Typing it honestly is what makes the
 * difference a compile error instead of an `undefined.length` at runtime.
 */
export type UiViewListItem = Pick<
  UiView,
  'slug' | 'name' | 'url' | 'description' | 'tags' | 'createdAt' | 'updatedAt'
> & { type: 'ui-view'; paramCount: number };

export const uiViewsApi = {
  async list(query: UiViewListQuery = {}): Promise<UiViewListItem[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<UiViewListItem>(await apiFetch(`/api/ui-views${q}`));
  },

  async get(slug: string): Promise<UiView> {
    return unwrap<UiView>(await apiFetch(`/api/ui-views/${encodeURIComponent(slug)}`));
  },

  async create(input: UiViewCreateInput): Promise<UiView> {
    return unwrap<UiView>(
      await apiFetch('/api/ui-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: UiViewUpdateInput): Promise<UiView> {
    return unwrap<UiView>(
      await apiFetch(`/api/ui-views/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await apiFetch(`/api/ui-views/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
};
