/**
 * `workspace-tools` — M31's own cross-cutting MCP server.
 *
 * One tool, `list_projects`. It is deliberately NOT folded into `c4s-tools`
 * (peer consultation) for two reasons:
 *
 *   - ownership: `c4s-tools` renders M11's `ask`; `list_projects` is M31's, and
 *     the kebab-case server name is supposed to say which module a tool belongs
 *     to;
 *   - reach: `c4s-tools` is mounted only for the `chat` and `patch` profiles
 *     (a consulted peer must not consult onward), while `list_projects` is a
 *     read-class operation that every profile admits — including `brief` and
 *     `ask`. Putting it on `c4s-tools` would have made workspace discovery
 *     inherit the recursion guard of an unrelated operation.
 *
 * In the `internal` channel this exists ALONGSIDE the `<workspace_projects>`
 * system-prompt block, not instead of it. That block is rendered once, on a
 * thread's first turn, and persisted — later turns do not refresh it, so a slug
 * that changed mid-thread makes `ask` fail with `PROJECT_SLUG_NOT_FOUND`. This
 * tool is how the agent gets a CURRENT picture of the workspace when that
 * happens.
 */

import { createMcpServer, mcpTool, type CapturedMcpServer } from '../plugin-runtime/index.js';
import type { ListProjectsResult } from '../workspace/list-projects.js';
import { toolFailure, toolSuccess } from '../operations/envelope.js';

/**
 * Takes a THUNK, not a snapshot: the registry is re-read on every call, so a
 * project registered (or renamed) while a thread is open shows up on the next
 * invocation. A captured `WorkspaceRecord` would have reproduced exactly the
 * staleness of the `<workspace_projects>` prompt block this tool exists to
 * work around.
 */
export function buildWorkspaceToolsServer(listProjects: () => ListProjectsResult): CapturedMcpServer {
  const listProjectsTool = mcpTool(
    'list_projects',
    [
      'List the projects of this workspace: id, slug, name, path.',
      'Use `slug` as the `project` argument of a peer consultation, and `id` as the `:id` segment of a project-scoped route.',
      'A project whose config.json cannot be read is still listed, without `name` — it stays addressable by `slug`.',
      'Read-only. No pagination.',
    ].join('\n'),
    {},
    /**
     * The `try/catch` is not decoration. Every sibling server in this directory
     * wraps its handler (`patch-tools`, `brief-tools`, `page-tools`, `plan-tools`,
     * `transagent-tools`); this one did not, so a throw out of `listProjects` —
     * an unreadable workspace registry, say — escaped as an unanswered request
     * instead of an error envelope. From the agent's side that is indistinguishable
     * from the server having gone silent, which is exactly the symptom this
     * release is here to make impossible to mistake.
     */
    async () => {
      try {
        return toolSuccess(listProjects(), { operation: 'list_projects', channel: 'mcp' });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  return createMcpServer({ name: 'workspace-tools', tools: [listProjectsTool] });
}
