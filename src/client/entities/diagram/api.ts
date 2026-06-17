import type {
  Diagram,
  DiagramCreateInput,
  DiagramListQuery,
  DiagramUpdateInput,
} from '../../../shared/entities.js';
import { handle, apiFetch } from '../../lib/api-core.js';

export interface DiagramWithWarnings extends Diagram {
  warnings?: string[];
}

export const diagramsApi = {
  async list(query: DiagramListQuery = {}): Promise<Diagram[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await handle<{ diagrams: Diagram[] }>(await apiFetch(`/api/diagrams${q}`));
    return data.diagrams;
  },

  async get(slug: string): Promise<Diagram> {
    return handle<Diagram>(await apiFetch(`/api/diagrams/${encodeURIComponent(slug)}`));
  },

  async create(input: DiagramCreateInput): Promise<DiagramWithWarnings> {
    return handle<DiagramWithWarnings>(
      await apiFetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: DiagramUpdateInput): Promise<DiagramWithWarnings> {
    return handle<DiagramWithWarnings>(
      await apiFetch(`/api/diagrams/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await apiFetch(`/api/diagrams/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
};
