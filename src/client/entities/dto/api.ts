import type {
  Dto,
  DtoCreateInput,
  DtoListQuery,
  DtoUpdateInput,
} from '../../../shared/entities.js';
import { handle, apiFetch } from '../../lib/api-core.js';

export const dtosApi = {
  async list(query: DtoListQuery = {}): Promise<Dto[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await handle<{ dtos: Dto[] }>(await apiFetch(`/api/dtos${q}`));
    return data.dtos;
  },

  async get(slug: string): Promise<Dto> {
    return handle<Dto>(await apiFetch(`/api/dtos/${encodeURIComponent(slug)}`));
  },

  async create(input: DtoCreateInput): Promise<Dto> {
    return handle<Dto>(
      await apiFetch('/api/dtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: DtoUpdateInput): Promise<Dto> {
    return handle<Dto>(
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
