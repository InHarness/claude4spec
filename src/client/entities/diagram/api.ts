import type {
  Diagram,
  DiagramCreateInput,
  DiagramListQuery,
  DiagramUpdateInput,
} from '../../../shared/entities.js';
import { handle, apiFetch, unwrap, unwrapList } from '../../lib/api-core.js';


export const diagramsApi = {
  async list(query: DiagramListQuery = {}): Promise<Diagram[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<Diagram>(await apiFetch(`/api/diagrams${q}`));
  },

  async get(slug: string): Promise<Diagram> {
    return unwrap<Diagram>(await apiFetch(`/api/diagrams/${encodeURIComponent(slug)}`));
  },

  /**
   * The DSL body, fetched by its own operation.
   *
   * 0.2.22 made `source` content-bearing, so it arrives from NO generic read —
   * `get`/`list` above answer with `hasSource` and `sourceBytes` instead. There
   * is deliberately no exception for the browser: this component fetches the
   * body through exactly the route an agent or the CLI would use, because the
   * width of a record is one question with one answer, not one answer per
   * audience.
   *
   * The response is the operation's envelope, not a bare string — `bytes` beside
   * `content` is what lets a caller check it received the whole thing.
   */
  async source(slug: string): Promise<string> {
    const res = await apiFetch(`/api/entities/diagram/${encodeURIComponent(slug)}/content/source`);
    const payload = await handle<{ content: string; bytes: number }>(res);
    return payload.content;
  },

  async create(input: DiagramCreateInput): Promise<Diagram> {
    return unwrap<Diagram>(
      await apiFetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: DiagramUpdateInput): Promise<Diagram> {
    return unwrap<Diagram>(
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
