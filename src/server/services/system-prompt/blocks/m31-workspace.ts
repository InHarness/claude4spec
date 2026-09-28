import { attrs, hasServer, selfClose } from '../glue.js';
import type { PeerProject, PromptBlock } from '../types.js';

/* M31 — Workspace: the peers `ask` can consult, with the address to pass. */

/**
 * 0.1.58: discovery block listing workspace peers the agent may consult via
 * `c4s-tools.ask`. The current project is excluded upstream.
 *
 * This is the prompt's model block: it carries exactly what a parameter
 * requires and nothing that is obtainable some other way.
 *
 * 2.1.0 — `id` is the project's ONLY address: the readable registry id, unique
 * in the workspace, which `ask({ project })` resolves and nothing else does.
 * `name` is the peer's own label and never a selector. The `path` attribute and
 * the path-based disambiguation of peers sharing a name are gone: ids cannot
 * collide inside a workspace, and a directory must never reach the agent.
 */
function buildWorkspaceProjects(workspaceName: string, peers: PeerProject[]): string {
  const lines = [`<workspace_projects ${attrs({ workspace: workspaceName })}>`];
  for (const p of peers) {
    lines.push(`  ${selfClose('peer', attrs({ id: p.id, name: p.name, description: p.description }))}`);
  }
  lines.push(
    `  \`id\` is the project's only address — pass it as the \`project\` argument of \`ask\`, exactly as shown. \`name\` is the peer's own label for itself and is NOT an address.`,
    `</workspace_projects>`,
  );
  return lines.join('\n');
}

export const M31_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'workspace_projects',
    // Gated on the SERVER being mounted rather than on a flag beside it: the
    // block exists to make `ask`'s `project` argument constructible, so it is
    // wanted exactly when `ask` is reachable.
    render: (c) =>
      hasServer(c.mcpInventory, 'c4s-tools') && c.workspaceProjects.length > 0
        ? buildWorkspaceProjects(c.workspaceName ?? '', c.workspaceProjects)
        : null,
  },
];
