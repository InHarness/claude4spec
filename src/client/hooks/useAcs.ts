import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acsApi } from '../entities/ac/api.js';
import type {
  Ac,
  AcCreateInput,
  AcListQuery,
  AcUpdateInput,
} from '../../shared/entities.js';

const keys = {
  all: ['acs'] as const,
  list: (q: AcListQuery) => ['acs', 'list', q] as const,
  detail: (slug: string) => ['ac', slug] as const,
};

export function useAcs(query: AcListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => acsApi.list(query),
  });
}

export function useAc(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['ac', 'none'],
    queryFn: () => acsApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateAc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AcCreateInput) => acsApi.create(input),
    onSuccess: (ac: Ac) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(ac.slug), ac);
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateAc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: AcUpdateInput }) =>
      acsApi.update(slug, input),
    onSuccess: (ac: Ac, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== ac.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(ac.slug), ac);
      qc.invalidateQueries({ queryKey: ['versions', 'ac', ac.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteAc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => acsApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
