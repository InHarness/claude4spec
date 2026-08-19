import { apiFetch, handle, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';
import { MCP_TOOL_PATH_PREFIX } from '../../../identity.js';
import type { McpTool, McpToolCreate, McpToolUpdate } from '../types.js';

/**
 * The client for the host's GENERATED router. Two properties of it shape this
 * file:
 *
 *  1. THE ENVELOPE — every generated route answers `{ data }` / `{ data, total }`,
 *     never a per-type key.
 *  2. THE WIDTH — `GET /:slug` answers the WHOLE record. No field of this type is
 *     `contentBearing`, so `logic` comes back with everything else and there is
 *     no second operation to call for it.
 *
 * `apiFetch` applies the `/api/projects/<id>` prefix; nothing here builds it.
 */
const BASE = `/api${MCP_TOOL_PATH_PREFIX}`;
const one = (slug: string) => `${BASE}/${encodeURIComponent(slug)}`;

export interface McpToolListQuery {
  search?: string;
  tags?: string[];
  tagFilter?: 'and' | 'or';
  limit?: number;
  offset?: number;
}

export const mcpToolsApi = {
  async list(query: McpToolListQuery = {}): Promise<McpTool[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<McpTool>(await apiFetch(`${BASE}${q}`));
  },

  async get(slug: string): Promise<McpTool> {
    return unwrap<McpTool>(await apiFetch(one(slug)));
  },

  async create(input: McpToolCreate): Promise<McpTool> {
    return unwrap<McpTool>(
      await apiFetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  /**
   * `newSlug` rides at the TOP LEVEL of the body, beside the fields rather than
   * inside them — the same split `update_entities` makes. It is also the ONLY
   * way this type's slug ever moves: the slug pattern runs at create and never
   * again, so editing `name` leaves the slug where it was.
   */
  async update(slug: string, input: McpToolUpdate & { newSlug?: string }): Promise<McpTool> {
    return unwrap<McpTool>(
      await apiFetch(one(slug), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  async remove(slug: string): Promise<unknown> {
    return handle<unknown>(await apiFetch(one(slug), { method: 'DELETE' }));
  },
};
