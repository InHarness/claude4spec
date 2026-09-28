/**
 * M31 / L1: workspace registry shapes persisted in `~/.claude4spec/workspaces.json`.
 * One file holds every workspace; workspace identity is the `name`.
 */

export interface ProjectRecord {
  /**
   * Absolute project directory. NOT an address: it never leaves the server
   * towards an agent or an external client (2.1.0). Editable by hand (a moved
   * repo) without changing `id`.
   */
  cwd: string;
  /**
   * 2.1.0 (M31 #13): readable, immutable project id — minted once at
   * registration from `config.json` `name` (fallback: directory name), see
   * `mintProjectId`. Never recomputed; no operation changes it. The display
   * name is NOT stored here — it always comes from `config.json`.
   */
  id: string;
  /** ISO timestamp of registration. */
  addedAt: string;
  /** ISO timestamp of the last SPA open / activation. */
  lastOpened?: string;
  /**
   * M33 phase 2: machine-local trust decision for this project's committed
   * `.claude4spec/plugins/` overlay, per `(workspace × project)`. Deliberately
   * lives ONLY in `~/.claude4spec/`, NEVER in the repo — a cloned repo cannot
   * self-authorize. `undefined` = undecided (prompt on first open); `true` =
   * overlay loads; `false` = overlay refused.
   */
  trustProjectPlugins?: boolean;
}

export interface WorkspaceRecord {
  /** Identity. Path-safe (used as a directory segment under ~/.claude4spec/). */
  name: string;
  mode: 'dev' | 'prod';
  /** Port the server listens on when this workspace is started without --port. */
  defaultPort: number;
  /**
   * 2.1.0: listen address (`--host`). Absent = loopback. Anything else exposes
   * an unauthenticated server to whoever can reach the address.
   */
  bindHost?: string;
  /**
   * 2.1.0: origin clients see (`--public-url`) — absolute http(s) URL without a
   * path. Absent = `http://localhost:<defaultPort>`. The only source of URLs
   * handed out (MCP snippets, external skills); never used for local discovery.
   */
  publicUrl?: string;
  /**
   * ISO timestamp of the last server start for this workspace. OPTIONAL: a
   * workspace that was never opened simply lacks the field — there is no zero
   * value for it, and existing records are never backfilled with one. Ordering
   * that reads it (the bare-start pick, `c4s list-workspaces`) has to place the
   * absent case explicitly rather than lean on a fallback string.
   */
  lastOpened?: string;
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
