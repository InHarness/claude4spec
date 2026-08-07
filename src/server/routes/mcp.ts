/**
 * The two MCP mount points.
 *
 * | path | posture | where the project comes from |
 * |---|---|---|
 * | `/api/projects/:id/mcp` | `project-bound` | the URL — the parameter has a default |
 * | `/api/workspace/mcp` | `workspace-bound` | `?project=` — the parameter has NO default |
 *
 * Both carry the same protocol and the same catalog. The only difference is
 * whether the project parameter has a default, which is exactly how the release
 * describes the pair — so the workspace mount does not offer a narrower surface,
 * it offers the same one with nothing filled in for you.
 *
 * **`project-bound` is a parameter default, not a permission boundary.** A
 * connection pinned to one project can still call `workspace`-scoped operations,
 * `list_projects` first among them. Without that the project-scoped catalog would
 * be unreachable from outside: a caller cannot name a project it cannot list.
 *
 * The project-bound mount lives INSIDE the per-project router deliberately. That
 * puts it behind `projectDispatchMiddleware`, which already answers
 * `404 PROJECT_NOT_IN_WORKSPACE` for an unknown `:id` and
 * `500 PROJECT_BUILD_FAILED` for a project whose build fails — the two codes this
 * release adds to the external catalog — and already resolves the context through
 * the cache on every request, which is where "rebuilt lazily" comes from.
 */

import { Router } from 'express';
import type { Request } from 'express';
import type { ChatContextType } from '../../shared/entities.js';
import { mcpRequestHandler, profileFromRequest } from '../mcp/http-mount.js';
import type { ExternalSurfaceDeps } from '../mcp/surface.js';
import type { ProjectContextCache } from '../workspace/context-cache.js';
import type { WorkspaceRegistry } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';

/** `/api/projects/:id/mcp` — mounted on the per-project router. */
export function projectMcpRouter(
  packageVersion: string,
  surfaceDeps: (profile: ChatContextType) => ExternalSurfaceDeps,
): Router {
  const router = Router();
  const handler = mcpRequestHandler({
    packageVersion,
    // The project is already resolved — this router only exists inside a built
    // context. Re-reading it per request is the middleware's job, and it has
    // done it before this line runs.
    resolve: async (req) => {
      const chosen = profileFromRequest(req);
      return surfaceDeps(chosen.ok ? chosen.profile : 'chat');
    },
    // This router instance belongs to exactly one project's context, so every
    // request through it is bound to the same thing — the pin is a no-op here
    // and exists for the workspace mount, where the selector is in the query.
    binding: () => 'project-bound',
  });
  router.post('/', handler);
  router.get('/', handler);
  router.delete('/', handler);
  return router;
}

export interface WorkspaceMcpDeps {
  registry: WorkspaceRegistry;
  workspace: WorkspaceRecord;
  cache: ProjectContextCache;
  packageVersion: string;
}

/**
 * Resolve `?project=` against the workspace: by registry id first, then by slug.
 *
 * "Slug" means the REGISTRY's name for the project (`ProjectRecord.name`) — the
 * same string `c4s --project <slug>` matches and the same one `list_projects`
 * reports as `slug`. That round-trip is the point: a caller discovers projects
 * with `list_projects` and connects with what it was handed.
 *
 * Explicitly NOT the display name from `config.json`. That is `list_projects`'
 * separate `name` field, it goes missing when the config is unreadable, and
 * matching on it would leave a project with a broken config addressable by an
 * id the caller was never told.
 */
function findProject(deps: WorkspaceMcpDeps, selector: string) {
  const fresh = deps.registry.getWorkspace(deps.workspace.name) ?? deps.workspace;
  return (
    fresh.projects.find((p) => p.id === selector) ?? fresh.projects.find((p) => p.name === selector) ?? null
  );
}

/** `/api/workspace/mcp` — mounted on the workspace router. */
export function workspaceMcpRouter(deps: WorkspaceMcpDeps): Router {
  const router = Router();
  const handler = mcpRequestHandler({
    packageVersion: deps.packageVersion,
    resolve: async (req: Request) => {
      const raw = req.query.project;
      const selector = typeof raw === 'string' ? raw.trim() : '';
      // No default here — that IS the posture. `null` becomes
      // PROJECT_NOT_IN_WORKSPACE, naming what the caller has to supply.
      if (selector === '') return null;
      const project = findProject(deps, selector);
      if (!project) return null;
      const ctx = await deps.cache.get(project);
      const chosen = profileFromRequest(req);
      return ctx.mcpSurfaceDeps(chosen.ok ? chosen.profile : 'chat');
    },
    // The raw selector, not the resolved id: two spellings of the same project
    // are the same binding only if the caller used the same one, and comparing
    // what the caller actually sent is what makes the pin checkable.
    binding: (req) => (typeof req.query.project === 'string' ? req.query.project.trim() : ''),
  });
  router.post('/', handler);
  router.get('/', handler);
  router.delete('/', handler);
  return router;
}
