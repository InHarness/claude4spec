import { apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';
import { UI_KIT_COMPONENT_PATH_PREFIX } from '../../../identity.js';
import type { UiKitComponent } from '../../../types.js';

/**
 * The client for the GENERATED router under `/api/ui-kit-components`
 * (`lf7jtgio`). Every generated route answers `{ data }` / `{ data, total }`;
 * `apiFetch` applies the `/api/projects/<id>` prefix.
 */
const BASE = `/api${UI_KIT_COMPONENT_PATH_PREFIX}`;

export const uiKitComponentsApi = {
  async list(query: { tags?: string[]; tagFilter?: 'and' | 'or' } = {}): Promise<UiKitComponent[]> {
    const params = new URLSearchParams();
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    // The host's list page cap; the catalog is a few dozen records.
    params.set('limit', '500');
    return unwrapList<UiKitComponent>(await apiFetch(`${BASE}?${params.toString()}`));
  },

  async get(slug: string): Promise<UiKitComponent> {
    return unwrap<UiKitComponent>(await apiFetch(`${BASE}/${encodeURIComponent(slug)}`));
  },
};
