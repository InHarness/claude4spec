import { useQuery } from '@tanstack/react-query';
import { sectionsApi } from '../lib/api.js';
import type { SectionIndexEntry } from '../../shared/entities.js';

export function useSection(anchor: string | null | undefined) {
  return useQuery<SectionIndexEntry | null>({
    queryKey: ['section', anchor ?? 'none'],
    queryFn: () => sectionsApi.getByAnchor(anchor as string),
    enabled: Boolean(anchor),
    staleTime: 30_000,
  });
}

export function useSectionsAutocomplete() {
  return useQuery<SectionIndexEntry[]>({
    queryKey: ['sections', 'all'],
    queryFn: () => sectionsApi.list(),
    staleTime: 30_000,
  });
}
