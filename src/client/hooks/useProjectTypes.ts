import { useQuery } from '@tanstack/react-query';
import type { ProjectTypeCard, ProjectTypeListResponse } from '../../shared/project-types.js';

/**
 * 2.1.77 (M57, endpoint `get-api-workspace-project-types`) — the project-type
 * registry as the client reads it, ascending by position: one query per page,
 * shared by the create-project page (type cards) and — 2.1.86 — the lists
 * grouped by type: `/welcome`, the project switcher and `Used skill projects`
 * (group names and order; the client never re-sorts it). The project shell
 * reads no type (M50, 2.1.86). The route lives outside the project prefix, so
 * it is read the same way on a workspace and on a project route.
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
 * never a branch on the slug: every type shares one path.
 * `null` while the list or the slug is unknown, or when no entry carries it.
 */
export function projectTypeNameFor(types: readonly ProjectTypeCard[] | undefined, slug: string | undefined): string | null {
  if (!types || !slug) return null;
  return types.find((t) => t.slug === slug)?.name ?? null;
}
