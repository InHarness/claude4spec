import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
 * profile would have silently converted every user's existing `c4s-spec-reader`
 * into a full write surface on upgrade, in the file claude4spec writes for them,
 * with no undo beyond git.
 *
 * That the EXTERNAL SURFACE can now carry writes is a deliberate decision of
 * this release. That the config we generate on the user's behalf should exercise
 * that is a different decision, and nobody made it. A user who wants a writing
 * connection can edit the URL or open a second entry; the generated default
 * keeps the guarantee the server name `c4s-spec-reader` still advertises.
 */
export const GENERATED_MCP_PROFILE = 'ask';

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
            url: `http://127.0.0.1:${port}${mcpMountPath(projectId)}?profile=${GENERATED_MCP_PROFILE}`,
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

/**
 * Refresh `mcp.json` for EVERY project in the workspace, with the port the
 * server actually bound.
 *
 * Called after `listen`, which is the first moment the real port is known and
 * the only moment every registered project is in view. Both facts matter, and
 * each fixes a way the previous call site was wrong:
 *
 *   - **Port.** It ran in `bootstrapProject` and wrote `workspace.defaultPort`.
 *     `--port 5000` against a workspace whose default is 4500 starts the server
 *     on 5000 and wrote a config pointing at 4500 — at best refused, at worst
 *     reaching a different workspace's server on that port. `listenOrExit` also
 *     retries, so even without a flag the bound port can differ from the request.
 *   - **Coverage.** `bootstrapProject` only runs for a project being created or
 *     re-activated. A plain start in an existing project rewrote nothing, so
 *     every project registered before 0.2.13 kept a STDIO entry — and the
 *     rewritten `c4s-mcp` rejects its `--project`/`--workspace` flags outright,
 *     exiting 2 on every editor launch. Upgrading has to repair those files, and
 *     nothing else in this release does.
 *
 * `writeIfChanged` keeps it a no-op when nothing moved, so this costs one hash
 * per project per start. A project directory that has gone away is skipped
 * rather than failing the boot: an unwritable config is not a reason to refuse
 * to serve the other projects.
 */
export function ensureMcpJsonForWorkspace(
  projects: readonly { id: string; cwd: string }[],
  port: number,
): void {
  for (const project of projects) {
    try {
      ensureMcpJson({ projectAbsPath: project.cwd, port, projectId: project.id });
    } catch {
      /* a removed or read-only project directory must not fail the start */
    }
  }
}
