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
 * Collapsing the last two is what turns "deleted in another tab" into a
 * permanent spinner.
 */
export function useGetBySlug(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : [DATABASE_TABLE_TYPE, 'detail', 'none'],
    queryFn: () => databaseTablesApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatabaseTableCreateInput) => databaseTablesApi.create(input),
    /**
     * INVALIDATE, do not seed.
     *
     * The detail query asks for `?view=detail`; a write answers
     * `single_element`, which for this type is the SUMMARY — counts, no
     * `columns`. Seeding the detail cache with it would leave the editor
     * rendering a table with no columns until the next refetch, and because the
     * editors render from `columns ?? []` it would do so silently.
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
