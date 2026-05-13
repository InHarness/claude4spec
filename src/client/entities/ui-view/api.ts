import type {
  UiView,
  UiViewCreateInput,
  UiViewListQuery,
  UiViewUpdateInput,
} from '../../../shared/entities.js';
import { handle } from '../../lib/api-core.js';

export interface UiViewWithWarnings extends UiView {
  warnings?: string[];
}

export const uiViewsApi = {
  async list(query: UiViewListQuery = {}): Promise<UiView[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await handle<{ uiViews: UiView[] }>(await fetch(`/api/ui-views${q}`));
    return data.uiViews;
  },

  async get(slug: string): Promise<UiView> {
    return handle<UiView>(await fetch(`/api/ui-views/${encodeURIComponent(slug)}`));
  },

  async create(input: UiViewCreateInput): Promise<UiViewWithWarnings> {
    return handle<UiViewWithWarnings>(
      await fetch('/api/ui-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(slug: string, input: UiViewUpdateInput): Promise<UiViewWithWarnings> {
    return handle<UiViewWithWarnings>(
      await fetch(`/api/ui-views/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(slug: string): Promise<{ deleted: true }> {
    return handle<{ deleted: true }>(
      await fetch(`/api/ui-views/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
};
