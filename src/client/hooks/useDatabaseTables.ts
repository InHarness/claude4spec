import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { databaseTablesApi, type DatabaseTableWithWarnings } from '../lib/api.js';
import type {
  DatabaseTable,
  DatabaseTableCreateInput,
  DatabaseTableListQuery,
  DatabaseTableUpdateInput,
} from '../../shared/entities.js';

const keys = {
  all: ['database-tables'] as const,
  list: (q: DatabaseTableListQuery) => ['database-tables', 'list', q] as const,
  detail: (slug: string) => ['database-table', slug] as const,
};

export function useDatabaseTables(query: DatabaseTableListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => databaseTablesApi.list(query),
  });
}

export function useDatabaseTable(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['database-table', 'none'],
    queryFn: () => databaseTablesApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DatabaseTableCreateInput) => databaseTablesApi.create(input),
    onSuccess: (dbTable: DatabaseTableWithWarnings) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(dbTable.slug), dbTable);
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: DatabaseTableUpdateInput }) =>
      databaseTablesApi.update(slug, input),
    onSuccess: (dbTable: DatabaseTableWithWarnings, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== dbTable.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(dbTable.slug), dbTable);
      qc.invalidateQueries({ queryKey: ['versions', 'database-table', dbTable.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => databaseTablesApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

// Used by entity registry — returns shape expected by registerEntity.useGetBySlug
export function useDatabaseTableForRegistry(slug: string | null): {
  data: DatabaseTable | null | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useDatabaseTable(slug);
  return { data: data ?? null, isLoading };
}
