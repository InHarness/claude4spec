import type { Ac, AcCreateInput, AcListQuery, AcUpdateInput } from '../../../types.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';
import { AC_PATH_PREFIX } from '../../../identity.js';

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
    return unwrapList<Ac>(await apiFetch(`/api${AC_PATH_PREFIX}${q}`));
  },

  async get(slug: string): Promise<Ac> {
    return unwrap<Ac>(await apiFetch(`/api${AC_PATH_PREFIX}/${encodeURIComponent(slug)}`));
  },

  async create(input: AcCreateInput): Promise<Ac> {
    return unwrap<Ac>(
      await apiFetch(`/api${AC_PATH_PREFIX}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  async update(slug: string, input: AcUpdateInput): Promise<Ac> {
    return unwrap<Ac>(
      await apiFetch(`/api${AC_PATH_PREFIX}/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await apiFetch(`/api${AC_PATH_PREFIX}/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    );
  },
};
