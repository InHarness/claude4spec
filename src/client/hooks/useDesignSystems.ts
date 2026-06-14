import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designSystemsApi, type DesignSystemWithWarnings } from '../lib/api.js';
import type {
  DesignSystem,
  DesignSystemCreateInput,
  DesignSystemListQuery,
  DesignSystemUpdateInput,
} from '../../shared/entities.js';

const keys = {
  all: ['design-systems'] as const,
  list: (q: DesignSystemListQuery) => ['design-systems', 'list', q] as const,
  detail: (slug: string) => ['design-system', slug] as const,
};

export function useDesignSystems(query: DesignSystemListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => designSystemsApi.list(query),
  });
}

export function useDesignSystem(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['design-system', 'none'],
    queryFn: () => designSystemsApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateDesignSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DesignSystemCreateInput) => designSystemsApi.create(input),
    onSuccess: (ds: DesignSystemWithWarnings) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(ds.slug), ds);
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateDesignSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: DesignSystemUpdateInput }) =>
      designSystemsApi.update(slug, input),
    onSuccess: (ds: DesignSystemWithWarnings, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== ds.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(ds.slug), ds);
      qc.invalidateQueries({ queryKey: ['versions', 'design-system', ds.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
      // A DS rename can repoint ui-view.designSystemSlug — refresh views too.
      qc.invalidateQueries({ queryKey: ['ui-views'] });
    },
  });
}

export function useDeleteDesignSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => designSystemsApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
      // Deletion makes referencing ui-views dangling — refresh them.
      qc.invalidateQueries({ queryKey: ['ui-views'] });
    },
  });
}

export function useDesignSystemForRegistry(slug: string | null): {
  data: DesignSystem | null | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useDesignSystem(slug);
  return { data: data ?? null, isLoading };
}
