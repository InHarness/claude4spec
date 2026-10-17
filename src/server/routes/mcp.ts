/**
 * The two MCP mount points.
 *
 * | path | posture | where the project comes from |
 * |---|---|---|
 * | `/api/projects/:id/mcp` | `project-bound` | the URL — the parameter has a default |
 * | `/api/workspace/mcp` | `workspace-bound` | the `project` argument of EACH call — no default |
 *
 * On the workspace-bound mount the connection itself carries no project (M12
 * `np1dkobs`, `y23ztuxm`): one session addresses different projects on
 * different calls, every `project`-scoped tool takes a `project` argument
 * (registry `id`), and `workspace`-scoped ones (`list_projects`, `ask`) need
 * none. `?project=` on its URL is a COMPATIBILITY SHIM for configs generated
 * before 2.1.28 — it must name a project of the workspace, and it fills the
 * argument when a call omits it. New configs do not carry it.
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
import { mcpRequestHandler } from '../mcp/http-mount.js';
import {
  bindProjectPerCall,
  composeExternalSurface,
  composeWorkspaceScopedSurface,
  type ExternalSurface,
  type ExternalSurfaceDeps,
  type ProjectCallTarget,
} from '../mcp/surface.js';
import { listProjects } from '../workspace/list-projects.js';
import type { ProjectContextCache } from '../workspace/context-cache.js';
import type { WorkspaceRegistry } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';

/** `/api/projects/:id/mcp` — mounted on the per-project router. */
export function projectMcpRouter(
  packageVersion: string,
  projectId: string,
  surfaceDeps: (profile: ChatContextType) => ExternalSurfaceDeps,
): Router {
  const router = Router();
  const handler = mcpRequestHandler({
    packageVersion,
    // The project is already resolved — this router only exists inside a built
    // context. Re-reading it per request is the middleware's job, and it has
    // done it before this line runs.
    surface: async (_req, profile) => composeExternalSurface(surfaceDeps(profile)),
    /**
     * The PROJECT ID, not a constant.
     *
     * This originally returned the literal `'project-bound'`, reasoning that a
     * router instance belongs to one project so every request through it is
     * bound to the same thing. That is true of the router and false of the
     * check: `SESSIONS` is module-global and keyed only by session id, so a
     * session opened on project A's router could be replayed against project
     * B's — a DIFFERENT router instance, whose constant compared equal. The
     * whole pin was a no-op on this mount, which is the one most clients use.
     */
    binding: () => `project:${projectId}`,
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

function freshWorkspace(deps: WorkspaceMcpDeps): WorkspaceRecord {
  return deps.registry.getWorkspace(deps.workspace.name) ?? deps.workspace;
}

/**
 * Resolve a project selector against the workspace — by registry `id` ONLY
 * (2.1.0). The id is the value `list_projects` and `<workspace_projects>` hand
 * out; a display name is never a selector, so passing one is refused with the
 * list of available ids.
 */
function findProject(deps: WorkspaceMcpDeps, selector: string) {
  return freshWorkspace(deps).projects.find((p) => p.id === selector) ?? null;
}

/** Ids only, never directories — the same message at handshake and per call. */
function notFoundMessage(deps: WorkspaceMcpDeps, selector: string): string {
  const fresh = freshWorkspace(deps);
  const ids = fresh.projects.map((p) => p.id).join(', ') || '(none)';
  return selector === ''
    ? `pass \`project\` (a project id) on this call; available ids in workspace '${fresh.name}': ${ids}`
    : `project '${selector}' is not registered in workspace '${fresh.name}' (pass the project id, not its name); available ids: ${ids}`;
}

/** The `?project=` compat default, trimmed; `''` when absent. */
function urlDefault(req: Request): string {
  const raw = req.query.project;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** `/api/workspace/mcp` — mounted on the workspace router. */
export function workspaceMcpRouter(deps: WorkspaceMcpDeps): Router {
  const router = Router();

  /**
   * One call's target: the call's own `project`, else the URL compat default.
   * Every failure is TOOL-level — the session stays usable for the next call
   * to a different project.
   */
  const resolveTarget = async (
    selector: string | undefined,
    fallback: string,
    profile: ChatContextType,
  ): Promise<ProjectCallTarget> => {
    const id = selector ?? fallback;
    const project = id === '' ? null : findProject(deps, id);
    if (!project) return { ok: false, code: 'PROJECT_NOT_IN_WORKSPACE', message: notFoundMessage(deps, id) };
    try {
      const ctx = await deps.cache.get(project);
      return { ok: true, projectId: project.id, surface: composeExternalSurface(ctx.mcpSurfaceDeps(profile)) };
    } catch (err) {
      return { ok: false, code: 'PROJECT_BUILD_FAILED', message: err instanceof Error ? err.message : String(err) };
    }
  };

  const handler = mcpRequestHandler({
    packageVersion: deps.packageVersion,
    surface: async (req: Request, profile, previous) => {
      const fallback = urlDefault(req);
      // The compat default must still name a project of this workspace — an
      // old config pointing at a migrated id fails loudly at the handshake
      // rather than on every call.
      if (fallback !== '' && !findProject(deps, fallback)) return null;
      const bind = (surface: ExternalSurface) =>
        bindProjectPerCall(surface, (selector) => resolveTarget(selector, fallback, profile));

      /**
       * What the session ADVERTISES: the catalog of a template project — the
       * compat default if there is one, else the workspace's first project.
       * Host-owned tools are the same in every project; a plugin active only in
       * another project is not advertised, and a call naming a project that
       * lacks an advertised tool answers NOT_FOUND.
       *
       * A template that fails to build does not break the session: an
       * established one keeps what it advertises (its handlers resolve per call
       * and report PROJECT_BUILD_FAILED there, where it belongs); a handshake
       * degrades to the workspace-scoped tools.
       */
      const template = findProject(deps, fallback) ?? freshWorkspace(deps).projects[0] ?? null;
      if (template) {
        try {
          const ctx = await deps.cache.get(template);
          return bind(composeExternalSurface(ctx.mcpSurfaceDeps(profile)));
        } catch {
          if (previous && previous.tools.length > 0) return previous;
        }
      }
      return bind(
        composeWorkspaceScopedSurface({
          profile,
          listProjects: () => listProjects(freshWorkspace(deps)),
          workspaceName: deps.workspace.name,
        }),
      );
    },
    /**
     * The WORKSPACE, namespaced so it can never equal the project mount's
     * `project:<id>` — the two mounts share one process-wide session registry.
     * The compat default is part of it: a session opened with one default must
     * not have it swapped by a later request's query string.
     */
    binding: (req) => `workspace:${deps.workspace.name}#default:${urlDefault(req)}`,
    notFoundMessage: (req) => notFoundMessage(deps, urlDefault(req)),
  });
  router.post('/', handler);
  router.get('/', handler);
  router.delete('/', handler);
  return router;
}
