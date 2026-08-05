import type {
  Dto,
  DtoCreateInput,
  DtoListQuery,
  DtoUpdateInput,
} from '../../../types.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';

export const dtosApi = {
  async list(query: DtoListQuery = {}): Promise<Dto[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<Dto>(await apiFetch(`/api/dtos${q}`));
  },

  /**
   * `?view=detail`, because the detail PAGE is what this feeds.
   *
   * `endpoints` — which endpoints reference this DTO — is a reverse join, so it
   * lives in the `detail` view and not in `single_element`. Until tier K, `dto`
   * had its own router that served the detail shape from `GET /:slug` and the
   * distinction never surfaced; the generated router answers `single_element`
   * unless asked, so the page has to ask.
   */
  async get(slug: string): Promise<Dto> {
    return unwrap<Dto>(await apiFetch(`/api/dtos/${encodeURIComponent(slug)}?view=detail`));
  },

  async create(input: DtoCreateInput): Promise<Dto> {
    return unwrap<Dto>(
      await apiFetch('/api/dtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: DtoUpdateInput): Promise<Dto> {
    return unwrap<Dto>(
      await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
};
