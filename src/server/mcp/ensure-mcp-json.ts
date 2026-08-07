import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** The mount-point path for a project's MCP surface — one source for the URL shape. */
export function mcpMountPath(projectId: string): string {
  return `/api/projects/${projectId}/mcp`;
}

/**
 * 0.2.13: an HTTP entry pointing at the server's mount point.
 *
 * It used to be a stdio entry — `npx -p @inharness-ai/claude4spec c4s-mcp
 * --project <abs> --workspace <name>` — which spawned a second process holding
 * its own read-only handle on the project's SQLite slot. The MCP surface now
 * lives in the server, so the config declares where to reach it instead of how
 * to start a copy of it.
 *
 * Two things dropped out of the file, and their absence is the point:
 *
 *   - **No absolute path.** Moving the spec repo used to invalidate this file;
 *     nothing in it names a location on disk any more, so the next activation
 *     refreshes only the URL.
 *   - **No workspace selector.** Workspace resolution belongs to M31 inside the
 *     server process. The project is addressed by the `:id` segment, and an id
 *     that is not in the workspace answers `PROJECT_NOT_IN_WORKSPACE` at the
 *     protocol level rather than failing a handshake.
 *
 * The file stays fully managed and gitignored. The server name `c4s-spec-reader`
 * is kept for continuity with existing client configs even though the surface it
 * names is no longer read-only — see the note in `mcp/surface.ts`.
 */
export function renderMcpJson({
  port,
  projectId,
}: {
  projectAbsPath: string;
  port: number;
  projectId: string;
}): string {
  return (
    JSON.stringify(
      {
        mcpServers: {
          'c4s-spec-reader': {
            type: 'http',
            // Loopback, not a hostname: the server is a local process, and a
            // config that resolved to anything else would be pointing a client
            // at someone else's specification.
            url: `http://127.0.0.1:${port}${mcpMountPath(projectId)}`,
          },
        },
      },
      null,
      2,
    ) + '\n'
  );
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function writeIfChanged(absPath: string, content: string): void {
  if (fs.existsSync(absPath)) {
    const existing = fs.readFileSync(absPath);
    if (sha256(existing) === sha256(content)) return;
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

/** Absolute path of the generated `.claude4spec/mcp.json` for a project — shared with M22's `<mcp-json-abs>` skill placeholder. */
export function mcpJsonPath(projectAbsPath: string): string {
  return path.join(projectAbsPath, '.claude4spec', 'mcp.json');
}

export function ensureMcpJson({
  projectAbsPath,
  port,
  projectId,
}: {
  projectAbsPath: string;
  port: number;
  projectId: string;
}): void {
  writeIfChanged(mcpJsonPath(projectAbsPath), renderMcpJson({ projectAbsPath, port, projectId }));
}
