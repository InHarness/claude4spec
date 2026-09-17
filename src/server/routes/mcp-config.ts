import { Router } from 'express';
import { renderMcpConfigVariants } from '../mcp/mcp-config.js';
import type { McpConfigResponse } from '../../shared/mcp-config.js';
import type { WorkspaceRegistry } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';

export interface McpConfigRouterDeps {
  registry: WorkspaceRegistry;
  workspace: WorkspaceRecord;
  projectId: string;
}

/**
 * 0.2.93 (M12) — `GET /api/projects/:id/_meta/mcp-config`, M12's only HTTP route.
 *
 * Read-only, no side effects, no disk access. The port and the project id are
 * injected from the workspace registry (M31) on EVERY request, so a changed
 * default port shows up on the next read with no refresh step.
 *
 * The CANONICAL port — the workspace's `defaultPort` — not the one this process
 * happened to bind: a one-off `--port 5050` or a `listenOrExit` retry is not the
 * address an editor should be sent to.
 */
export function mcpConfigRouter(deps: McpConfigRouterDeps): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const live = deps.registry.getWorkspace(deps.workspace.name) ?? deps.workspace;
    const body: McpConfigResponse = {
      variants: renderMcpConfigVariants({ port: live.defaultPort, projectId: deps.projectId }),
    };
    res.json(body);
  });
  return router;
}
