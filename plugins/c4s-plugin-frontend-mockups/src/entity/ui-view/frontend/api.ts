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
 * generated router serves the declared list view instead. Typing it honestly is
 * what makes a difference a compile error instead of an `undefined.length` at
 * runtime.
 *
 * `paramCount` used to sit here and was FICTION: nothing on the server produces
 * it. `projectedCollections` emits a `{ count }` shape only for `keyed`
 * collections, and `params` is a `value` collection, so the row carries the
 * `params[]` array itself — which is why the list's trailing badge rendered
 * `undefinedp` on every row. The array is what the wire sends, so the array is
 * what this declares.
 *
 * `hasMockupHtml` is NOT a field of the entity: `mockupHtml` is `contentBearing`,
 * and the host swaps the value for a `has<Field>`/`<field>Bytes` descriptor pair
 * derived from the field name. `project()` emits that pair regardless of
 * `select`, so it rides on every projection width — including this one, at no
 * extra read. `mockupHtmlBytes` is deliberately NOT declared: the list must not
 * present the size (that belongs to the `Details` descriptor), and leaving it
 * off the type is the cheapest way to make a future misuse a compile error.
 */
export type UiViewListItem = Pick<
  UiView,
  'slug' | 'title' | 'url' | 'description' | 'params' | 'tags' | 'createdAt' | 'updatedAt'
> & { type: 'ui-view'; hasMockupHtml: boolean };

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
