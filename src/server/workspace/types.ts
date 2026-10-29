import type { WorkspaceFileErrorCode } from './home-workspace.js';

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
  /**
   * ISO timestamp of registration. Absent on a project of a home workspace:
   * its record comes from the committed `workspace.json`, which carries no
   * machine-local attribute.
   */
  addedAt?: string;
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
  /**
   * 2.1.57 (M31 `44viw74p`, M52 `ybbal0vf`): machine-local confirmation of the
   * skill attachments (`skill.uses`) this project's committed `config.json`
   * carries — the same record, for the same reason as `trustProjectPlugins`: a
   * cloned repo cannot self-authorize. Only `true` lets an attachment resolve to
   * its provider; absent or `false` = not confirmed, every attachment resolves to
   * none and warns like a dangling one.
   * ASSUMPTION:dev-0002 — one boolean confirms the whole attachment list; asked
   * on the `#skills` settings card.
   */
  trustSpecSkillHooks?: boolean;
}

/**
 * 2.1.58 (M31 `44viw74p`): machine-local trust of one project of a home
 * workspace, kept in the registry entry (keyed `(home, project-id)` — the entry
 * carries the home) together with the project's relative path at the time the
 * consent was given. A view path that no longer matches voids every flag here:
 * the project reads as undecided until consent is given again.
 */
export interface HomeProjectTrust {
  path: string;
  trustProjectPlugins?: boolean;
  trustSpecSkillHooks?: boolean;
}

/**
 * The workspace VIEW (M31 `t97gncju`): what every reader sees. For a registry
 * workspace it is the registry entry itself; for a workspace with a home it is
 * the entry composed with `<home>/.claude4spec/workspace.json` — `projects` and
 * `plugins` come from the file, trust is folded into each project record.
 */
export interface WorkspaceRecord {
  /** Identity. Path-safe (used as a directory segment under ~/.claude4spec/). */
  name: string;
  /**
   * 2.1.58: only a workspace with a home directory — the absolute path of that
   * directory. Absent = a registry workspace.
   */
  home?: string;
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
  /**
   * 2.1.58 (M31 `fjsgq19h`): id of the project opened last in this workspace,
   * both kinds; set on every project open. Absent = no project opened yet; an
   * id no longer in the workspace means the same as absent. Machine-local: it
   * lives in the registry entry, never in `workspace.json`.
   */
  lastOpenedProject?: string;
  /**
   * 2.1.62 (M31 `fjsgq19h`, `t97gncju`): runner-host records, both kinds, a
   * machine-local attribute — it lives in the registry entry, never in
   * `workspace.json`. The record shape, its writes and its supervision belong
   * to the runner-hosts module (M54 `fo9bukuw`); M31 only carries the array and
   * writes it with the entry-write guarantee (`WorkspaceRegistry.updateEntry`).
   */
  runnerHosts?: unknown[];
  projects: ProjectRecord[];
  /**
   * M33: npm plugin package names loaded at process bootstrap, workspace-global
   * (orthogonal to per-project `config.entities` activation). User-added entries
   * only — predefined core packages are merged in at resolve time, not persisted.
   * Absent on legacy records (schema < 2) = predefined-only.
   */
  plugins?: string[];
  /**
   * 2.1.58: only on the view of a workspace with a home whose `workspace.json`
   * does not validate — the refusal its start gets (code + message naming the
   * file). Such a view lists no projects and no plugins; the other workspaces
   * read on unaffected. ASSUMPTION:dev-0103.
   */
  fileError?: { code: WorkspaceFileErrorCode; message: string };
  /**
   * 2.1.58 (M31 `459ucmfg`): only on the view of a workspace with a home whose
   * home directory does not exist on this machine (a deleted or moved checkout).
   * Such a view also carries `fileError` (the file cannot be read), but it is
   * not a broken file: `c4s list-workspaces` shows it as `home-missing`, and the
   * CLI resolver treats it as a workspace with no projects instead of refusing
   * with WORKSPACE_FILE_INVALID.
   */
  homeMissing?: true;
}

/**
 * A workspace entry as persisted in `workspaces.json`. A registry entry carries
 * `projects[]` and `plugins[]`; an entry with `home` carries neither — they live
 * in the committed `workspace.json` — and holds `projectTrust` instead.
 */
export interface StoredWorkspaceRecord extends Omit<WorkspaceRecord, 'projects'> {
  projects?: ProjectRecord[];
  projectTrust?: Record<string, HomeProjectTrust>;
}

export interface WorkspacesFile {
  $schemaVersion: number;
  workspaces: StoredWorkspaceRecord[];
}
