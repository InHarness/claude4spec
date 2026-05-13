import { useQuery } from '@tanstack/react-query';
import { referencesApi } from '../lib/api.js';
import type { EntityType } from '../../shared/entities.js';

export function useReferences(type: EntityType, slug: string | null) {
  return useQuery({
    queryKey: ['references', type, slug ?? 'none'],
    queryFn: () => referencesApi.find(type, slug as string),
    enabled: Boolean(slug),
  });
}
