import type {
  DesignSystem,
  DesignSystemCreateInput,
  DesignSystemListQuery,
  DesignSystemUpdateInput,
} from '../../../shared/entities.js';
import { handle, apiFetch } from '../../lib/api-core.js';

export interface DesignSystemWithWarnings extends DesignSystem {
  warnings?: string[];
}

export const designSystemsApi = {
  async list(query: DesignSystemListQuery = {}): Promise<DesignSystem[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await handle<{ designSystems: DesignSystem[] }>(
      await apiFetch(`/api/design-systems${q}`)
    );
    return data.designSystems;
  },

  async get(slug: string): Promise<DesignSystem> {
    return handle<DesignSystem>(await apiFetch(`/api/design-systems/${encodeURIComponent(slug)}`));
  },

  async create(input: DesignSystemCreateInput): Promise<DesignSystemWithWarnings> {
    return handle<DesignSystemWithWarnings>(
      await apiFetch('/api/design-systems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: DesignSystemUpdateInput): Promise<DesignSystemWithWarnings> {
    return handle<DesignSystemWithWarnings>(
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
