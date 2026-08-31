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
 * `groupCount`/`tokenCount` used to sit here and were FICTION, the same fiction
 * `UiViewListItem` carried as `paramCount`: nothing on the server produces
 * either. `projectedCollections` emits a `{ count }` shape only for `keyed`
 * collections, and `groups`/`modes` are both `value` collections, so the row
 * carries the arrays themselves — which is why every row of the list rendered
 * `undefined groups / undefined tokens`.
 *
 * `groups[]` (every token, with its resolved value per mode) really is the
 * expensive half of this entity and a list that only renders two numbers has no
 * use for it, so narrowing the read would be worth doing. But that is a change
 * to the wire, and until it happens the honest type is the one that says what
 * arrives. See `countsOf` below for the derivation the rows use.
 */
export type DesignSystemListItem = Pick<
  DesignSystem,
  'slug' | 'title' | 'description' | 'groups' | 'tags' | 'createdAt' | 'updatedAt'
> & { type: 'design-system' };

/**
 * Group and token counts, derived rather than read.
 *
 * Lives here, beside the type that explains why the counts are not on the wire,
 * so the list page and the sidebar row cannot drift apart on the answer — and
 * so neither is tempted to read a `groupCount` field again.
 */
export function countsOf(entity: DesignSystem | DesignSystemListItem): {
  groups: number;
  tokens: number;
} {
  const groups = entity.groups ?? [];
  return { groups: groups.length, tokens: groups.reduce((acc, g) => acc + g.tokens.length, 0) };
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
