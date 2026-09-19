import { attrs, hasServer, selfClose } from '../glue.js';
import type { PeerProject, PromptBlock } from '../types.js';

/* M31 — Workspace: the peers `ask` can consult, with the address to pass. */

/**
 * 0.1.58: discovery block listing workspace peers the agent may consult via
 * `c4s-tools.ask`. The current project is excluded upstream.
 *
 * This is the prompt's model block, and the reason is worth naming: it carries
 * exactly what a parameter requires and nothing that is obtainable some other
 * way. There is no tool that lists peers, so without this block the `project`
 * argument is unguessable — which is the test every block in this file should
 * pass and most of them did not.
 *
 * 0.2.50 — `id` REPLACES `path` as the address, and `name` is demoted to a
 * label. `resolveWorkspaceProject` tries the value as a path first and then
 * falls back to `findProjectByName`, so a name IS an address — but the registry
 * name, which is not the display name this block used to render beside the path.
 * A peer shown as "C4S - App Spec" is registered as `app-spec`, and passing the
 * former answers PROJECT_SLUG_NOT_FOUND. That was found by making the call; the
 * simplification it refutes ("drop the path, the name is the address") had
 * survived three readings of the code.
 *
 * `id` is therefore `registryName`, and a peer whose registry name is somehow
 * missing keeps `path` so it stays reachable rather than becoming decorative.
 *
 * So does a peer whose registry name it SHARES. The name is not a key — the
 * registry says so in as many words — and a shared name answers
 * `AMBIGUOUS_PROJECT` (since 0.2.97 also inside one workspace; before it, the
 * first match won silently and the second peer was unaddressable). `path` is
 * tried before the name fallback and is exact, so the peers that collide keep
 * it. The block stays short in the ordinary case and stays USABLE in the case
 * where the name alone cannot say which project is meant.
 */
function buildWorkspaceProjects(workspaceName: string, peers: PeerProject[]): string {
  const lines = [`<workspace_projects ${attrs({ workspace: workspaceName })}>`];
  const nameCounts = new Map<string, number>();
  for (const p of peers) {
    if (p.registryName) nameCounts.set(p.registryName, (nameCounts.get(p.registryName) ?? 0) + 1);
  }
  for (const p of peers) {
    const unique = p.registryName !== undefined && nameCounts.get(p.registryName) === 1;
    lines.push(
      `  ${selfClose(
        'peer',
        attrs({
          id: p.registryName,
          name: p.name,
          path: unique ? undefined : p.path,
          description: p.description,
        }),
      )}`,
    );
  }
  lines.push(
    `  Pass a peer's \`id\` as the \`project\` argument of \`ask\` — that is the registry name the resolver matches. \`name\` is the peer's own label for itself and is NOT an address. Where a \`path\` is also shown, that peer's \`id\` is shared with another project and only the path addresses it unambiguously — pass the path.`,
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
