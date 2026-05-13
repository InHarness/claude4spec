import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dtosApi } from '../lib/api.js';
import type {
  Dto,
  DtoCreateInput,
  DtoListQuery,
  DtoUpdateInput,
} from '../../shared/entities.js';

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
    onSuccess: (dto: Dto) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(dto.slug), dto);
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
      qc.setQueryData(keys.detail(dto.slug), dto);
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
