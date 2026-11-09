import { useQuery } from '@tanstack/react-query';
import type { ProjectTypeCard, ProjectTypeListResponse } from '../../shared/project-types.js';

/**
 * 2.1.77 (M57, endpoint `get-api-workspace-project-types`) — the project-type
 * registry as the client reads it: one query per page, shared by the
 * create-project page (type cards) and the project shell (the type label of the
 * sidebar's Branding strip, M50 `76e8kkze`). The route lives outside the project
 * prefix, so it is read the same way on a workspace and on a project route.
 */
export const PROJECT_TYPES_QUERY_KEY = ['project-types'] as const;

async function fetchProjectTypes(): Promise<ProjectTypeCard[]> {
  const res = await fetch('/api/workspace/project-types');
  if (!res.ok) throw new Error(`GET /api/workspace/project-types failed (HTTP ${res.status})`);
  return ((await res.json()) as ProjectTypeListResponse).types;
}

export function useProjectTypes(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: PROJECT_TYPES_QUERY_KEY, queryFn: fetchProjectTypes, enabled: opts.enabled ?? true });
}

/**
 * The name of the registry entry whose slug is `slug` — a lookup in the list,
 * never a branch on the slug: every type shares one path (M50 `76e8kkze`).
 * `null` while the list or the slug is unknown, or when no entry carries it.
 */
export function projectTypeNameFor(types: readonly ProjectTypeCard[] | undefined, slug: string | undefined): string | null {
  if (!types || !slug) return null;
  return types.find((t) => t.slug === slug)?.name ?? null;
}
