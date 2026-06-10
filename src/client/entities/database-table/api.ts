import type {
  DatabaseTable,
  DatabaseTableCreateInput,
  DatabaseTableDanglingFk,
  DatabaseTableListQuery,
  DatabaseTableUpdateInput,
} from '../../../shared/entities.js';
import { handle, apiFetch } from '../../lib/api-core.js';

export interface DatabaseTableWithWarnings extends DatabaseTable {
  warnings?: string[];
}

export const databaseTablesApi = {
  async list(query: DatabaseTableListQuery = {}): Promise<DatabaseTable[]> {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.tagFilter) params.set('tagFilter', query.tagFilter);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await handle<{ databaseTables: DatabaseTable[] }>(
      await apiFetch(`/api/database-tables${q}`)
    );
    return data.databaseTables;
  },

  async get(slug: string): Promise<DatabaseTable> {
    return handle<DatabaseTable>(
      await apiFetch(`/api/database-tables/${encodeURIComponent(slug)}`)
    );
  },

  async create(input: DatabaseTableCreateInput): Promise<DatabaseTableWithWarnings> {
    return handle<DatabaseTableWithWarnings>(
      await apiFetch('/api/database-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async update(
    slug: string,
    input: DatabaseTableUpdateInput
  ): Promise<DatabaseTableWithWarnings> {
    return handle<DatabaseTableWithWarnings>(
      await apiFetch(`/api/database-tables/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    );
  },

  async remove(
    slug: string
  ): Promise<{ deleted: true; danglingFks: DatabaseTableDanglingFk[] }> {
    return handle<{ deleted: true; danglingFks: DatabaseTableDanglingFk[] }>(
      await apiFetch(`/api/database-tables/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    );
  },
};
