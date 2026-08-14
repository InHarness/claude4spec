import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { databaseTablesApi } from './api.js';
import { DATABASE_TABLE_TYPE } from '../../../identity.js';
import type {
  DatabaseTable,
  DatabaseTableCreateInput,
  DatabaseTableListItem,
  DatabaseTableListQuery,
  DatabaseTableUpdateInput,
} from '../types.js';

const keys = {
  all: [DATABASE_TABLE_TYPE] as const,
  list: (q: DatabaseTableListQuery) => [DATABASE_TABLE_TYPE, 'list', q] as const,
  detail: (slug: string) => [DATABASE_TABLE_TYPE, 'detail', slug] as const,
};

export function useDatabaseTableList(query: DatabaseTableListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => databaseTablesApi.list(query),
  });
}

/**
 * THREE STATES, and the panel discriminates all three: `undefined` while
 * loading, `null` when the slug resolves to nothing, the table otherwise.
 *
 * The `null` arm has to be MADE. `apiFetch` → `handle()` throws `ApiError` on
 * any non-2xx, so a 404 left `data` permanently `undefined` and the panel
 * rendered a skeleton forever — the exact "deleted in another tab → permanent
 * spinner" outcome this comment used to claim it prevented, with the
 * `entity === null` branch unreachable dead code beneath it.
 *
 * Only 404 becomes `null`. A 500 or a dropped connection still throws, because
 * "this table does not exist" and "the server did not answer" are different
 * facts and the panel should not report the second as the first.
 */
export function useGetBySlug(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : [DATABASE_TABLE_TYPE, 'detail', 'none'],
    queryFn: async (): Promise<DatabaseTable | null> => {
      try {
        return await databaseTablesApi.get(slug as string);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(slug),
    // A missing entity is an ANSWER, not a failure to get one — retrying it
    // just delays the empty state by the backoff.
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 3,
  });
}

export function useCreateDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatabaseTableCreateInput) => databaseTablesApi.create(input),
    /**
     * INVALIDATE, do not seed.
     *
     * A write's response and a read's are the same shape since 0.2.23 — one
     * record, `columns` included — so seeding no longer risks what it used to:
     * the detail query asked for `?view=detail` while a write answered the
     * counts-only summary, and seeding that left the editor rendering a table
     * with no columns, silently, because the editors render `columns ?? []`.
     * It stays an invalidate because a refetch also picks up concurrent writes.
     */
    onSuccess: (table: DatabaseTable) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: keys.detail(table.slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: DatabaseTableUpdateInput }) =>
      databaseTablesApi.update(slug, body),
    onSuccess: (table: DatabaseTable, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      // A rename moved the row: the old key can never resolve again.
      if (slug !== table.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: keys.detail(table.slug) });
      qc.invalidateQueries({ queryKey: ['versions', DATABASE_TABLE_TYPE, table.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      // A rename repoints references inside pages, so their cache is stale too.
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug }: { slug: string }) => databaseTablesApi.remove(slug),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

/** The `listByTags` slot the host calls to fill a tag page. */
export async function listByTags(
  tags: string[],
  filter: 'and' | 'or' = 'or',
): Promise<DatabaseTableListItem[]> {
  return databaseTablesApi.list({ tags, tagFilter: filter });
}

/** The name the list screen and the slash popover were written against. */
export { useDatabaseTableList as useDatabaseTables };
