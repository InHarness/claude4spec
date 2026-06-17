import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diagramsApi, type DiagramWithWarnings } from '../entities/diagram/api.js';
import type {
  Diagram,
  DiagramCreateInput,
  DiagramListQuery,
  DiagramUpdateInput,
} from '../../shared/entities.js';

const keys = {
  all: ['diagrams'] as const,
  list: (q: DiagramListQuery) => ['diagrams', 'list', q] as const,
  detail: (slug: string) => ['diagram', slug] as const,
};

export function useDiagrams(query: DiagramListQuery = {}) {
  return useQuery({
    queryKey: keys.list(query),
    queryFn: () => diagramsApi.list(query),
  });
}

export function useDiagram(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : ['diagram', 'none'],
    queryFn: () => diagramsApi.get(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DiagramCreateInput) => diagramsApi.create(input),
    onSuccess: (d: DiagramWithWarnings) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.detail(d.slug), d);
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: DiagramUpdateInput }) =>
      diagramsApi.update(slug, input),
    onSuccess: (d: DiagramWithWarnings, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== d.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(d.slug), d);
      qc.invalidateQueries({ queryKey: ['versions', 'diagram', d.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => diagramsApi.remove(slug),
    onSuccess: (_data, slug) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useDiagramForRegistry(slug: string | null): {
  data: Diagram | null | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useDiagram(slug);
  return { data: data ?? null, isLoading };
}
