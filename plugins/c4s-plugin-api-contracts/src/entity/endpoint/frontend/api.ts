import type {
  Endpoint,
  EndpointCreateInput,
  EndpointDtoRelation,
  EndpointListQuery,
  EndpointUpdateInput,
} from '../../../types.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';

export const endpointsApi = {
  async list(query: EndpointListQuery = {}): Promise<Endpoint[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<Endpoint>(await apiFetch(`/api/endpoints${q}`));
  },

  async get(slug: string): Promise<Endpoint> {
    return unwrap<Endpoint>(await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}`));
  },

  async create(input: EndpointCreateInput): Promise<Endpoint> {
    return unwrap<Endpoint>(
      await apiFetch('/api/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: EndpointUpdateInput): Promise<Endpoint> {
    return unwrap<Endpoint>(
      await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },

  async linkDto(
    slug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null = null
  ): Promise<Endpoint> {
    // NOT `unwrap` — the two relation routes are `endpoint`'s own domain router,
    // not the generated one, and still answer with the bare endpoint. K3 moves
    // them onto the generic collection write and the envelope with them.
    return handle<Endpoint>(
      await apiFetch(`/api/endpoints/${encodeURIComponent(slug)}/dtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dtoSlug, relation, statusCode }),
      })
    );
  },

  async unlinkDto(
    slug: string,
    dtoSlug: string,
    relation: EndpointDtoRelation,
    statusCode: number | null = null
  ): Promise<Endpoint> {
    const url = new URL(
      `/api/endpoints/${encodeURIComponent(slug)}/dtos/${encodeURIComponent(dtoSlug)}/${relation}`,
      window.location.origin
    );
    if (statusCode !== null) url.searchParams.set('statusCode', String(statusCode));
    return handle<Endpoint>(await apiFetch(url.pathname + url.search, { method: 'DELETE' }));
  },
};
