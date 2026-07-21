import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

export const PROJECT_ROUTE_RE = /^\/p\/([0-9a-f]{12})(\/|$)/;

export type SpaResolution =
  | { kind: 'project'; project: ProjectRecord }
  | { kind: 'redirect'; to: string }
  | { kind: 'welcome' };

/**
 * M31 route scheme `/p/<project-id>/…` (assets stay at root — no Vite base
 * changes). 0.1.137: `/` is now an UNCONDITIONAL 302 to `/welcome` — the root
 * never auto-jumps to a project again (it used to pick the last-opened one, else
 * the first registered, and only fall through to `/welcome` on an empty
 * workspace). `/welcome` serves the SPA with NO project injected (workspace-scope
 * project list); unknown id and any other non-asset path → redirect `/`, which
 * chains to `/welcome`.
 */
export function resolveSpaRoute(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  urlPath: string,
): SpaResolution {
  const m = urlPath.match(PROJECT_ROUTE_RE);
  if (m) {
    const project = registry.getProject(workspace, m[1]!);
    return project ? { kind: 'project', project } : { kind: 'redirect', to: '/' };
  }
  if (urlPath === '/welcome') return { kind: 'welcome' };
  if (urlPath === '/' || urlPath === '') return { kind: 'redirect', to: '/welcome' };
  return { kind: 'redirect', to: '/' };
}
