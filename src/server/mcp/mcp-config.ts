import type { McpConfigVariant } from '../../shared/mcp-config.js';

/** The mount-point path for a project's MCP surface — one source for the URL shape. */
export function mcpMountPath(projectId: string): string {
  return `/api/projects/${projectId}/mcp`;
}

/**
 * The profile the GENERATED config asks for.
 *
 * `ask`, not the `chat` default, and this is the one decision in this file that
 * is about safety rather than addressing.
 *
 * The entry this replaced launched a process that opened the db `readonly: true`
 * and could not write a byte, whatever any model asked of it. The mount's
 * default profile is `chat`, which admits writes — so generating a URL with no
 * profile would have silently converted every user's existing reader entry
 * into a full write surface, in a config claude4spec hands them, with no undo.
 *
 * A user who wants a writing connection can edit the URL or open a second
 * entry; the generated default keeps the read-only guarantee the server name
 * `c4s-reader` advertises.
 */
export const GENERATED_MCP_PROFILE = 'ask';

/**
 * The entry's key in the client's `mcpServers` map — the name the spec's
 * snippet `wpis-serwera-c4s-reader` (M12 "Warianty wpisu") gives it, and the
 * same name the composed server reports (`EXTERNAL_MCP_SERVER_NAME` in
 * `mcp/surface.ts`). 2.1.14 aligned it: until then the generated entry was keyed
 * `c4s-spec-reader`, the external SKILL's name, not the server's.
 */
export const MCP_CONFIG_SERVER_KEY = 'c4s-reader';

function entry(server: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers: { [MCP_CONFIG_SERVER_KEY]: server } }, null, 2) + '\n';
}

/**
 * 0.2.93 — the MCP connection config, rendered PER REQUEST.
 *
 * Until 0.2.93 the same entry was written to `<project>/.claude4spec/mcp.json`
 * at activation and at every server start, which dragged in a gitignore line, a
 * sha256 idempotence check, an ownership guard between workspaces sharing a
 * directory, a bundle exclusion and a clone-rollback artifact. Rendering on
 * demand removes all of it, and the snippet is current on the first read after
 * a port change or a repo move — nothing has to be refreshed.
 *
 * The three variants are a contract, in presentation order. The entry SHAPES
 * are the ones the file carried; only the delivery channel changed:
 *
 *   - `http-project` — the project-bound mount, project addressed by the URL.
 *   - `http-workspace` — the workspace-bound mount, project named by `?project=`
 *     (the registry id — `findProject` in `routes/mcp.ts` matches it first).
 *   - `stdio` — the `c4s-mcp` bridge, for clients that cannot speak HTTP. It
 *     relays to the project-bound mount; it never starts a server. 2.1.14
 *     (M11 m11pkg00): `c4s-mcp` is not the package's default bin, so a
 *     no-install launch names the package with `-p` —
 *     `npx -y -p @inharness-ai/claude4spec c4s-mcp`.
 *
 * 2.1.0 — every snippet joins the workspace's effective `publicUrl` with the
 * project `id`, BOTH taken from the registry, never from request headers (a
 * forged `Host` must not end up in a config a client copies). With no
 * `publicUrl` set that is `http://localhost:<defaultPort>`.
 * No absolute path and no workspace selector — resolution belongs to M31
 * inside the server.
 */
export function renderMcpConfigVariants({
  publicUrl,
  projectId,
}: {
  publicUrl: string;
  projectId: string;
}): McpConfigVariant[] {
  const origin = publicUrl.replace(/\/+$/, '');
  const projectUrl = `${origin}${mcpMountPath(projectId)}?profile=${GENERATED_MCP_PROFILE}`;
  const workspaceUrl =
    `${origin}/api/workspace/mcp?project=${encodeURIComponent(projectId)}&profile=${GENERATED_MCP_PROFILE}`;
  return [
    { id: 'http-project', label: 'HTTP · project', snippet: entry({ type: 'http', url: projectUrl }) },
    { id: 'http-workspace', label: 'HTTP · workspace', snippet: entry({ type: 'http', url: workspaceUrl }) },
    {
      id: 'stdio',
      label: 'stdio bridge',
      snippet: entry({
        command: 'npx',
        args: ['-y', '-p', '@inharness-ai/claude4spec', 'c4s-mcp', '--url', projectUrl],
      }),
    },
  ];
}
