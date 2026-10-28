import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

// 2.1.0: readable ids (`[a-z0-9-]`, ≤ 48 chars). A pre-2.1.0 `/p/<hash>/`
// bookmark still matches the shape, finds no project and redirects to `/`.
export const PROJECT_ROUTE_RE = /^\/p\/([a-z0-9][a-z0-9-]{0,47})(\/|$)/;

/**
 * M31 `eb95ery1`: the client paths of the WORKSPACE routes — mounted outside the
 * project prefix, served without a project identity, in the workspace route
 * frame (M50 `1bd92aq2`). `/workspace/settings` joins with its page (unit
 * `workspace-settings-split`).
 */
export const WORKSPACE_ROUTE_PATHS: readonly string[] = ['/welcome'];

export type SpaResolution =
  | { kind: 'project'; project: ProjectRecord }
  | { kind: 'redirect'; to: string }
  | { kind: 'workspace' };

/**
 * M31 route scheme `/p/<project-id>/…` (assets stay at root — no Vite base
 * changes). 0.1.137: `/` is an UNCONDITIONAL 302 to `/welcome` — the root never
 * auto-jumps to a project. A workspace route serves the SPA with NO project
 * injected (M50 `k4fhsrkz`); an unknown id and any other non-asset path that is
 * not a workspace route → redirect `/`, which chains to `/welcome`.
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
  if (WORKSPACE_ROUTE_PATHS.includes(urlPath)) return { kind: 'workspace' };
  if (urlPath === '/' || urlPath === '') return { kind: 'redirect', to: '/welcome' };
  return { kind: 'redirect', to: '/' };
}

/**
 * M50 `k4fhsrkz` — the application document for a resolved route. A route with
 * a project gets its identity as ONE global, `window.__C4S_PROJECT__ = { id,
 * name }`, injected right after `<head>` — first, before the modules' inline
 * scripts (the theme script) and the app bundle: the client reads it
 * synchronously at module load to scope project-keyed local storage
 * (`::<scope>`), build `/api/projects/<id>` and the router basepath `/p/<id>`.
 * M31: the id comes from the ROUTE (`/p/<id>/…` → registry lookup) and is the
 * STORED `project.id`, never recomputed from the cwd. A workspace route
 * (`identity: null`) has no project: nothing is injected, and the inline
 * scripts run exactly as on a project route.
 */
export function spaDocument(html: string, identity: { id: string; name: string } | null): string {
  if (!identity) return html;
  const payload = JSON.stringify({ id: identity.id, name: identity.name }).replace(/</g, '\\u003c');
  return html.replace('<head>', `<head><script>window.__C4S_PROJECT__=${payload};</script>`);
}
