/**
 * M31 / L1: workspace registry shapes persisted in `~/.claude4spec/workspaces.json`.
 * One file holds every workspace; workspace identity is the `name`.
 */

export interface ProjectRecord {
  /** Absolute project directory; the source of `id`. */
  cwd: string;
  /** `projectIdForCwd(cwd)` — sha1(cwd).slice(0,12). */
  id: string;
  /** Display name (defaults to basename(cwd) at registration). */
  name: string;
  /** ISO timestamp of registration. */
  addedAt: string;
  /** ISO timestamp of the last SPA open / activation. */
  lastOpened?: string;
}

export interface WorkspaceRecord {
  /** Identity. Path-safe (used as a directory segment under ~/.claude4spec/). */
  name: string;
  mode: 'dev' | 'prod';
  /** Port the server listens on when this workspace is started without --port. */
  defaultPort: number;
  /** ISO timestamp of the last server start for this workspace. */
  lastOpened: string;
  projects: ProjectRecord[];
  /**
   * M33: npm plugin package names loaded at process bootstrap, workspace-global
   * (orthogonal to per-project `config.entities` activation). User-added entries
   * only — predefined core packages are merged in at resolve time, not persisted.
   * Absent on legacy records (schema < 2) = predefined-only.
   */
  plugins?: string[];
}

export interface WorkspacesFile {
  $schemaVersion: number;
  workspaces: WorkspaceRecord[];
}
