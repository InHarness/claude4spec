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

  async get(slug: string): Promise<Dto> {
    return unwrap<Dto>(await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`));
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
