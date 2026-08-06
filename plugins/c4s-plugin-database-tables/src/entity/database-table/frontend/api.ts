import { apiFetch, handle, unwrap, unwrapList } from '../../../frontend-kit/api-core.js';
import { DATABASE_TABLE_PATH_PREFIX } from '../../../identity.js';
import type {
  DatabaseTable,
  DatabaseTableCreateInput,
  DatabaseTableListItem,
  DatabaseTableListQuery,
  DatabaseTableUpdateInput,
} from '../types.js';

/**
 * The client for the GENERATED router, not for the retired hand-written one.
 *
 * Two differences the port has to respect, and both were live bugs waiting in a
 * straight copy of the plugin's own client:
 *
 *  1. THE ENVELOPE. Every generated route answers `{ data }` / `{ data, total }`,
 *     never a per-type key like `{ databaseTables }`.
 *  2. THE VIEW. `GET /:slug` answers `single_element`, which for this type is the
 *     SUMMARY — counts, no arrays. The detail page needs the columns, so it has
 *     to ask for `?view=detail`. The retired router served the full record from
 *     the bare GET and the distinction never arose.
 *
 * `apiFetch` applies the `/api/projects/<id>` prefix; nothing here builds it.
 */
const BASE = `/api${DATABASE_TABLE_PATH_PREFIX}`;
const one = (slug: string) => `${BASE}/${encodeURIComponent(slug)}`;

export const databaseTablesApi = {
  async list(query: DatabaseTableListQuery = {}): Promise<DatabaseTableListItem[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    return unwrapList<DatabaseTableListItem>(await apiFetch(`${BASE}${q}`));
  },

  /** `?view=detail` — the summary view carries counts, and this page needs the columns. */
  async get(slug: string): Promise<DatabaseTable> {
    return unwrap<DatabaseTable>(await apiFetch(`${one(slug)}?view=detail`));
  },

  async create(input: DatabaseTableCreateInput): Promise<DatabaseTable> {
    return unwrap<DatabaseTable>(
      await apiFetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  },

  /**
   * `newSlug` rides at the TOP LEVEL of the body, beside the fields — it is a
   * sibling of the payload, not a field of it, which is the same split
   * `update_entities` makes.
   */
  async update(slug: string, input: DatabaseTableUpdateInput): Promise<DatabaseTable> {
    return unwrap<DatabaseTable>(
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
