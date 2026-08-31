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
 * `paramCount` used to sit here and was FICTION: nothing produced it, so the
 * list's trailing badge rendered `undefinedp` on every row. 0.2.55 made the idea
 * behind it real rather than deleting it — `params` is declared `listOverview`,
 * so a LIST read answers with `paramsCount`, counted rather than read, while a
 * single-entity GET still carries the array. The name is `paramsCount` (from the
 * FIELD, `params`) and not the `paramCount` that never worked.
 *
 * `hasMockupHtml` is NOT a field of the entity: `mockupHtml` is `contentBearing`,
 * and the host swaps the value for a `has<Field>`/`<field>Bytes` descriptor pair
 * derived from the field name. It arrives here at no extra read — but for a
 * narrower reason than "descriptors always ride along". `project()` tests
 * `wanted` BEFORE it reaches the `contentBearing` branch, so a `select` that does
 * not name `mockupHtml` drops `hasMockupHtml` entirely; what makes it present is
 * that `hydrateRows` sends no `select` at all.
 *
 * Which is the trap worth naming: narrowing this read with a `select` — the
 * obvious optimisation, since `params[]` is the expensive thing on the row —
 * would silently delete the mockup chip from every row, with no type error and
 * no failing unit test. `select` it explicitly if that day comes; the e2e case
 * in `frontend-mockups-envelope.test.ts` is what would catch it.
 *
 * `mockupHtmlBytes` is deliberately NOT declared: the list must not present the
 * size (that belongs to the `Details` descriptor), and leaving it off the type is
 * the cheapest way to make a future misuse a compile error.
 */
export type UiViewListItem = Pick<
  UiView,
  'slug' | 'title' | 'url' | 'description' | 'tags' | 'createdAt' | 'updatedAt'
> & { type: 'ui-view'; hasMockupHtml: boolean; paramsCount: number };

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
