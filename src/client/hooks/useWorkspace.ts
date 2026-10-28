import { useQuery } from '@tanstack/react-query';
import { fetchWorkspace } from '../lib/workspace.js';

/**
 * M31 L5 Zapytania — "dane workspace'u i lista projektów". One query shared by
 * every reader on the page (the workspace-route header entry, the Welcome
 * screen, the project-detach window, the project-route switcher), so a page that shows several of them
 * asks `GET /api/workspace` once. Workspace scope: no project prefix, so it
 * works on the project-less workspace routes as well as on a project route.
 * `enabled: false` keeps a reader that needs the list only on demand (the
 * switcher, until it opens) from fetching; flipping it on refetches a stale
 * entry (default `staleTime: 0`), so every open sees a fresh list.
 */
export const WORKSPACE_QUERY_KEY = ['workspace'] as const;

export function useWorkspace({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: WORKSPACE_QUERY_KEY, queryFn: fetchWorkspace, enabled });
}
