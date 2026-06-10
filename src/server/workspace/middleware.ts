import type { RequestHandler } from 'express';
import { ProjectBuildFailedError, type ProjectContextCache } from './context-cache.js';
import type { WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

/**
 * M31 transport middleware — mounted at `/api/projects/:id`. Resolves the
 * project from the URL prefix, lazily builds/fetches its context, and
 * dispatches into the per-context router (Express strips the mount path, so
 * ctx routers are mounted `/api`-less).
 *
 * - unknown id → 404 PROJECT_NOT_IN_WORKSPACE, before any handler
 * - build failure → 500 PROJECT_BUILD_FAILED for that project only;
 *   the process keeps serving the rest
 */
export function projectDispatchMiddleware(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cache: ProjectContextCache,
): RequestHandler {
  return async (req, res, next) => {
    const id = req.params.id ?? '';
    const project = registry.getProject(workspace, id);
    if (!project) {
      return res.status(404).json({
        error: {
          code: 'PROJECT_NOT_IN_WORKSPACE',
          message: `project '${id}' is not registered in workspace '${workspace.name}'`,
        },
      });
    }
    try {
      const ctx = await cache.get(project);
      ctx.router(req, res, next);
    } catch (err) {
      const message =
        err instanceof ProjectBuildFailedError ? err.message : err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: { code: 'PROJECT_BUILD_FAILED', message },
      });
    }
  };
}
