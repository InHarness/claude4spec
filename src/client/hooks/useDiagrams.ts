import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diagramsApi } from '../entities/diagram/api.js';
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
  /**
   * The body is cached under its OWN key, not inside the entity's.
   *
   * It arrives from a different operation and it is the expensive half, so a
   * list refetch has no reason to drop it and an entity refetch has no reason
   * to refetch it. Invalidated explicitly on update below, which is the only
   * thing that changes it.
   */
  source: (slug: string) => ['diagram', slug, 'source'] as const,
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

/**
 * The DSL body of one diagram.
 *
 * Separate from `useDiagram` because `source` is content-bearing: no generic
 * read carries it, so a component that renders a diagram makes two calls — the
 * entity for its metadata, this for the body it draws. Everything that renders
 * a diagram goes through here, so the browser reads content exactly the way an
 * agent does.
 */
export function useDiagramSource(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.source(slug) : ['diagram', 'none', 'source'],
    queryFn: () => diagramsApi.source(slug as string),
    enabled: Boolean(slug),
  });
}

export function useCreateDiagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DiagramCreateInput) => diagramsApi.create(input),
    onSuccess: (d: Diagram) => {
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
    onSuccess: (d: Diagram, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      if (slug !== d.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.setQueryData(keys.detail(d.slug), d);
      // The body lives under its own key and only a write moves it.
      qc.invalidateQueries({ queryKey: keys.source(d.slug) });
      if (slug !== d.slug) qc.removeQueries({ queryKey: keys.source(slug) });
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
