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
  workspace,
}: {
  projectAbsPath: string;
  port: number;
  projectId: string;
  /** Which workspace generated this file. Provenance only — see {@link OWNER_KEY}. */
  workspace: string;
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
        [OWNER_KEY]: { workspace },
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Where the generating workspace is recorded — provenance, NOT addressing.
 *
 * The file deliberately carries no workspace selector: resolution belongs to M31
 * inside the server, and the reader addresses the project by the `:id` segment
 * alone. But the WRITER still has to answer "is this file mine?", and it had
 * nothing to answer with. `projectId` cannot: it is `sha1(cwd)`, so the same
 * directory registered in two workspaces produces the same id in both and the
 * ownership guard below compared a value to itself. The port cannot either —
 * it is the one component that legitimately changes for the owner.
 *
 * An unknown top-level key is ignored by MCP clients, so this changes nothing
 * about what the file MEANS to a reader.
 */
export const OWNER_KEY = 'x-c4s-generated-by';

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

/**
 * Which project the file on disk currently addresses, if it is one of ours.
 *
 * `null` for an absent, unreadable, or non-HTTP file — the last of which is the
 * pre-0.2.13 stdio entry this release has to replace, so "not ours" and "ours,
 * addressing project X" must be distinguishable rather than both falsy.
 */
function addressedProjectId(absPath: string): string | null {
  return readManaged(absPath)?.projectId ?? null;
}

/**
 * The file's own account of itself: which project it addresses, and which
 * workspace wrote it.
 *
 * `null` for an absent, unreadable, or non-HTTP file — the last of which is the
 * pre-0.2.13 stdio entry this release has to replace, so "not ours" and "ours,
 * addressing project X" must be distinguishable rather than both falsy.
 * `workspace: null` inside a non-null result is the third state: ours, written
 * before this field existed, and therefore adoptable.
 */
function readManaged(absPath: string): { projectId: string; workspace: string | null } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8')) as {
      mcpServers?: Record<string, { type?: string; url?: string }>;
      [OWNER_KEY]?: { workspace?: unknown };
    };
    const url = parsed.mcpServers?.['c4s-spec-reader']?.url;
    if (typeof url !== 'string') return null;
    const projectId = /\/api\/projects\/([^/?#]+)\/mcp/.exec(url)?.[1];
    if (!projectId) return null;
    const workspace = parsed[OWNER_KEY]?.workspace;
    return { projectId, workspace: typeof workspace === 'string' ? workspace : null };
  } catch {
    return null;
  }
}

export function ensureMcpJson({
  projectAbsPath,
  port,
  projectId,
  workspace,
}: {
  projectAbsPath: string;
  port: number;
  projectId: string;
  workspace: string;
}): void {
  const target = mcpJsonPath(projectAbsPath);
  /**
   * A file another WORKSPACE generated is left alone.
   *
   * One directory can be registered in two workspaces, and it has one
   * `mcp.json`. Whichever server started last would otherwise own it, so an
   * editor open on workspace A would silently start talking to workspace B's
   * copy of the specification — the same repo, a different database, a
   * different set of entities, and no error anywhere to say so. First writer
   * wins is not obviously the right owner, but it is stable, and a stale
   * address the user can see beats a live one pointing at the wrong project.
   *
   * This compared `projectId` until the review caught that the comparison could
   * never be true: `projectIdForCwd` is a pure hash of the absolute path, so
   * both workspaces derive the SAME id for the shared directory and the guard
   * was a no-op. The port is the only thing that differed — and the port is
   * exactly what the owner is allowed to change. Hence {@link OWNER_KEY}.
   *
   * A managed file with no owner recorded predates the field and is adopted,
   * so upgrading does not strand anyone's config.
   */
  const existing = readManaged(target);
  if (existing !== null && existing.workspace !== null && existing.workspace !== workspace) return;
  writeIfChanged(target, renderMcpJson({ projectAbsPath, port, projectId, workspace }));
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
 *
 * ## A transient server does not get to re-point the editor at itself
 *
 * The bound port is the right address only when this process is the workspace's
 * CANONICAL server. `npx @inharness-ai/claude4spec --port 5050` — a one-off, a
 * second instance, a debugging run — is not, and writing 5050 into every
 * project's config leaves all of them addressing a dead port the moment it
 * exits, while the default-port server keeps running and answering nothing.
 * `listenOrExit` retries on a busy port, so this happens without a flag too.
 *
 * So a non-canonical process writes only what is MISSING or still stdio (the
 * upgrade repair, which is time-critical: the rewritten `c4s-mcp` exits 2 on
 * every editor launch until it is replaced), and it writes the CANONICAL
 * address rather than its own — the address that works once the normal server
 * is up. It never rewrites a healthy HTTP entry.
 */
export function ensureMcpJsonForWorkspace(
  projects: readonly { id: string; cwd: string }[],
  port: number,
  canonicalPort: number = port,
  workspace = 'default',
): void {
  const canonical = port === canonicalPort;
  for (const project of projects) {
    try {
      /**
       * A registered project whose directory is gone is SKIPPED, and this check
       * is what makes the sentence above true.
       *
       * The `try/catch` was written as if a missing directory would throw. It
       * does not: `writeIfChanged` calls `fs.mkdirSync(dirname, { recursive: true })`,
       * which happily creates the whole path. Combined with this function's new
       * reach — every registered project, on every start, where the old call site
       * only ran for a project being created — that turned boot into a step that
       * re-materializes directories the user deleted. `rm -rf ~/specs/old-product`
       * without unregistering it, and it comes back as
       * `~/specs/old-product/.claude4spec/mcp.json` on the next start, and the
       * one after that.
       *
       * The registry entry is stale, not the directory: writing a config into a
       * path the user removed cannot help any editor, because there is no project
       * there to serve.
       */
      if (!fs.existsSync(project.cwd)) continue;
      const target = mcpJsonPath(project.cwd);
      // Ours and healthy, written by a canonical start: a transient one leaves it.
      if (!canonical && addressedProjectId(target) !== null) continue;
      ensureMcpJson({
        projectAbsPath: project.cwd,
        port: canonical ? port : canonicalPort,
        projectId: project.id,
        workspace,
      });
    } catch {
      /* a removed or read-only project directory must not fail the start */
    }
  }
}
