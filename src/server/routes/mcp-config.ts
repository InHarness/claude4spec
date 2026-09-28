import { Router } from 'express';
import { renderMcpConfigVariants } from '../mcp/mcp-config.js';
import { effectivePublicUrl } from '../../core/workspace/network.js';
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
 * Read-only and free of side effects; the only read is the workspace registry
 * file, which `getWorkspace` re-reads per request so a changed default port
 * shows up on the next read with no refresh step.
 *
 * 2.1.0 — the address is the workspace's effective `publicUrl` (registry), not
 * the port this process happened to bind and not the request's `Host`: a
 * one-off `--port 5050` is not the address an editor should be sent to, and a
 * header is not a source of truth. Changing `publicUrl` or the workspace port
 * shows up on the next read with no refresh step.
 */
export function mcpConfigRouter(deps: McpConfigRouterDeps): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const live = deps.registry.getWorkspace(deps.workspace.name) ?? deps.workspace;
    const body: McpConfigResponse = {
      variants: renderMcpConfigVariants({ publicUrl: effectivePublicUrl(live), projectId: deps.projectId }),
    };
    res.json(body);
  });
  return router;
}
