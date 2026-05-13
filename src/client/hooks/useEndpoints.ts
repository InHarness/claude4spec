import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpointsApi } from '../lib/api.js';
import type {
  Endpoint,
  EndpointCreateInput,
  EndpointDtoRelation,
  EndpointListQuery,
  EndpointUpdateInput,
} from '../../shared/entities.js';

const keys = {
  all: ['endpoints'] as const,
  list: (q: EndpointListQuery) => ['endpoints', 'list', q] as const,
  detail: (slug: string) => ['endpoint', slug] as const,
};

export function useEndpoints(query: EndpointListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => endpointsApi.list(query),
  });
}

export function useEndpoint(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['endpoint', 'none'],
    queryFn: () => endpointsApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EndpointCreateInput) => endpointsApi.create(input),
    onSuccess: (ep: Endpoint) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(ep.slug), ep);
    },
  });
}

export function useUpdateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: EndpointUpdateInput }) =>
      endpointsApi.update(slug, input),
    onSuccess: (ep: Endpoint, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== ep.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(ep.slug), ep);
      qc.invalidateQueries({ queryKey: ['versions', 'endpoint', ep.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useLinkDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      dtoSlug,
      relation,
      statusCode,
    }: {
      slug: string;
      dtoSlug: string;
      relation: EndpointDtoRelation;
      statusCode?: number | null;
    }) => endpointsApi.linkDto(slug, dtoSlug, relation, statusCode ?? null),
    onSuccess: (ep: Endpoint) => {
      qc.setQueryData(keys.detail(ep.slug), ep);
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: ['dtos'] });
      for (const link of ep.dtos) qc.invalidateQueries({ queryKey: ['dto', link.dtoSlug] });
    },
  });
}

export function useUnlinkDto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      dtoSlug,
      relation,
      statusCode,
    }: {
      slug: string;
      dtoSlug: string;
      relation: EndpointDtoRelation;
      statusCode?: number | null;
    }) => endpointsApi.unlinkDto(slug, dtoSlug, relation, statusCode ?? null),
    onSuccess: (ep: Endpoint, vars) => {
      qc.setQueryData(keys.detail(ep.slug), ep);
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: ['dtos'] });
      qc.invalidateQueries({ queryKey: ['dto', vars.dtoSlug] });
    },
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => endpointsApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
