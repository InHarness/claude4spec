import type {
  Ac,
  AcCreateInput,
  AcListQuery,
  AcUpdateInput,
} from '../../../shared/entities.js';
import { handle } from '../../lib/api-core.js';

export const acsApi = {
  async list(query: AcListQuery = {}): Promise<Ac[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.status) params.set('status', query.status);
    if (query.kind) params.set('kind', query.kind);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await handle<{ acs: Ac[] }>(await fetch(`/api/acs${q}`));
    return data.acs;
  },

  async get(slug: string): Promise<Ac> {
    return handle<Ac>(await fetch(`/api/acs/${encodeURIComponent(slug)}`));
  },

  async create(input: AcCreateInput): Promise<Ac> {
    return handle<Ac>(
      await fetch('/api/acs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  async update(slug: string, input: AcUpdateInput): Promise<Ac> {
    return handle<Ac>(
      await fetch(`/api/acs/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await fetch(`/api/acs/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    );
  },
};
