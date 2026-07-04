import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { versionsApi } from '../lib/api.js';
import type { EntityType } from '../../shared/entities.js';

export function useVersions(type: EntityType, slug: string | null) {
  return useQuery({
    queryKey: slug ? ['versions', type, slug] : ['versions', type, 'none'],
    queryFn: () => versionsApi.list(type, slug as string),
    enabled: Boolean(slug),
  });
}

export function useVersionDetail(type: EntityType, slug: string | null, version: number | null) {
  return useQuery({
    queryKey: slug && version ? ['version', type, slug, version] : ['version', 'none'],
    queryFn: () => versionsApi.get(type, slug as string, version as number),
    enabled: Boolean(slug && version),
  });
}

/** M34/L11: restore an entity to an exact captured version. */
export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, slug, version }: { type: EntityType; slug: string; version: number }) =>
      versionsApi.restore(type, slug, version),
    onSuccess: (_data, { type, slug }) => {
      qc.invalidateQueries({ queryKey: ['versions', type, slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
