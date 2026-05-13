import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uiViewsApi, type UiViewWithWarnings } from '../lib/api.js';
import type {
  UiView,
  UiViewCreateInput,
  UiViewListQuery,
  UiViewUpdateInput,
} from '../../shared/entities.js';

const keys = {
  all: ['ui-views'] as const,
  list: (q: UiViewListQuery) => ['ui-views', 'list', q] as const,
  detail: (slug: string) => ['ui-view', slug] as const,
};

export function useUiViews(query: UiViewListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => uiViewsApi.list(query),
  });
}

export function useUiView(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['ui-view', 'none'],
    queryFn: () => uiViewsApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateUiView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UiViewCreateInput) => uiViewsApi.create(input),
    onSuccess: (uiView: UiViewWithWarnings) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(uiView.slug), uiView);
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateUiView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: UiViewUpdateInput }) =>
      uiViewsApi.update(slug, input),
    onSuccess: (uiView: UiViewWithWarnings, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== uiView.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(uiView.slug), uiView);
      qc.invalidateQueries({ queryKey: ['versions', 'ui-view', uiView.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteUiView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => uiViewsApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

// Used by entity registry — returns shape expected by registerEntity.useGetBySlug
export function useUiViewForRegistry(slug: string | null): {
  data: UiView | null | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useUiView(slug);
  return { data: data ?? null, isLoading };
}
