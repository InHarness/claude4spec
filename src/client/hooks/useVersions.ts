import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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

/**
 * Exported so the sentinel/null-input permutations can be unit-tested without
 * rendering the hook (no React Testing Library in this repo).
 */
export function versionDiffQueryKey(
  type: EntityType,
  slug: string | null,
  fromId: number | null,
  toId: number | null
): unknown[] {
  return slug && fromId && toId ? ['version-diff', type, slug, fromId, toId] : ['version-diff', type, 'none'];
}

/** M13/M34: plugin-facing hook — computed diff between two captured versions. */
export function useVersionDiff(type: EntityType, slug: string | null, fromId: number | null, toId: number | null) {
  return useQuery({
    queryKey: versionDiffQueryKey(type, slug, fromId, toId),
    queryFn: () => versionsApi.diff(type, slug as string, fromId as number, toId as number),
    enabled: Boolean(slug && fromId && toId),
  });
}

/**
 * Exported so the invalidation set can be unit-tested against a real
 * QueryClient without rendering the hook (no React Testing Library in this
 * repo). Every per-type entity hook (useDto, useEndpoint, useAc, ...) keys
 * its detail query as [type, slug] — the one convention consistent enough
 * for this cross-cutting, entity-type-agnostic hook to rely on without
 * importing each type's own key helper. Without the last invalidation, an
 * open detail view keeps showing pre-restore data.
 */
export function invalidateAfterVersionRestore(qc: QueryClient, type: EntityType, slug: string): void {
  qc.invalidateQueries({ queryKey: ['versions', type, slug] });
  qc.invalidateQueries({ queryKey: ['tags'] });
  qc.invalidateQueries({ queryKey: [type, slug] });
}

/** M34/L11: restore an entity to an exact captured version. */
export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, slug, version }: { type: EntityType; slug: string; version: number }) =>
      versionsApi.restore(type, slug, version),
    onSuccess: (_data, { type, slug }) => invalidateAfterVersionRestore(qc, type, slug),
  });
}
