import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dtosApi } from './api.js';
import type {
  Dto,
  DtoCreateInput,
  DtoListQuery,
  DtoUpdateInput,
} from '../../../types.js';

const keys = {
  all: ['dtos'] as const,
  list: (q: DtoListQuery) => ['dtos', 'list', q] as const,
  detail: (slug: string) => ['dto', slug] as const,
};

export function useDtos(query: DtoListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => dtosApi.list(query),
  });
}

export function useDto(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['dto', 'none'],
    queryFn: () => dtosApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DtoCreateInput) => dtosApi.create(input),
    /**
     * INVALIDATE, do not seed.
     *
     * A write's response and a read's are the same shape since 0.2.23 — one
     * record per type — so seeding is no longer WRONG the way it was when the
     * detail query asked for `?view=detail` and a POST answered the narrower
     * `single_element`. It stays an invalidate anyway: the record is derived
     * from the row the write produced, and a refetch is the only thing that
     * also picks up what OTHER writes did to the same entity.
     *
     * The rule this settles: a write response is not a substitute for the read
     * a page performs, unless the two are known to be the same view.
     */
    onSuccess: (dto: Dto) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: keys.detail(dto.slug) });
    },
  });
}

export function useUpdateDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: DtoUpdateInput }) =>
      dtosApi.update(slug, input),
    onSuccess: (dto: Dto, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== dto.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      // Invalidated, not seeded — see `useCreateDto`.
      qc.invalidateQueries({ queryKey: keys.detail(dto.slug) });
      qc.invalidateQueries({ queryKey: ['versions', 'dto', dto.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => dtosApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
