import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mintProjectId } from './project-id.js';
import { readPeerConfigSummary } from './peer-config.js';
import {
  isMigrationPendingFor,
  planRegistryMigration,
  READABLE_IDS_SCHEMA_VERSION,
  type ProjectIdRename,
} from './registry-migration.js';
import { findSlotIdForCwd, listSlotIds, readSlotMarker, writeSlotMarker } from './slot-marker.js';
import { withAdvisoryLock, writeJsonAtomic } from './advisory-lock.js';
import {
  ensureHomeDescription,
  findWorkspaceHomeUp,
  firstFreePort,
  homeEntryName,
  isProjectDirectory,
  repositoryHintFor,
  WorkspaceSelectionError,
  type WorkspaceSelection,
} from './start-selection.js';
import {
  ensureHomeGitignore,
  homeLocalDir,
  mutateWorkspaceFile,
  readWorkspaceFile,
  sameProjectPath,
  toProjectPath,
  WorkspaceFileError,
  type WorkspaceFile,
} from './home-workspace.js';
import type {
  HomeProjectTrust,
  ProjectRecord,
  StoredWorkspaceRecord,
  WorkspaceRecord,
  WorkspacesFile,
} from './types.js';

// v2 (M33): WorkspaceRecord gains optional `plugins[]`. Legacy v1 records lack
// the field and read as predefined-only — no rewrite needed on read.
// v3 (2.1.0): readable project ids (M31 #13) + workspace `bindHost`/`publicUrl`.
// A v≤2 file with projects needs the id migration, which ONLY the server runs
// (`migrateIfNeeded`, before listen). Until then reads see the migrated ids in
// memory and writes refuse with REGISTRY_MIGRATION_PENDING. An older binary
// refuses a v3 file (read() forward-compat guard): a one-way upgrade.
export const WORKSPACES_SCHEMA_VERSION = READABLE_IDS_SCHEMA_VERSION;
export const DEFAULT_WORKSPACE_PORT = 4500;
const DEFAULT_WORKSPACE_NAME = 'default';

/**
 * M33: plugin packages built into claude4spec core deps — always present in
 * every workspace regardless of the persisted `plugins[]`, trusted by virtue of
 * installation (outside the workspace `trustProjectPlugins` gate) and loaded
 * FIRST, before any workspace-declared plugin.
 *
 * Currently EMPTY. `@inharness-ai/c4s-plugin-simple-database-tables` used to sit
 * here as the preinstalled owner of `database-table`; it is retired in favour of
 * `@inharness-ai/c4s-plugin-database-tables`, the full spec implementation,
 * which a workspace declares in its own `plugins[]`. Leaving the retired package
 * here would not merely duplicate the type — base-tier registration is a plain
 * `Map.set` keyed by entity type, so the two would silently race for ownership
 * on load order, and their migrations share one `plugin_schema_migrations`
 * namespace (keyed by TYPE, not by package). The successor reads the same
 * on-disk format, so removing this entry loses no data.
 */
export const PREDEFINED_PLUGINS: readonly string[] = [];

/**
 * Find a project record by its stored directory. Single source of truth for
 * this lookup — reused by `resolveWorkspacesForCwd` below and by
 * `resolveWorkspaceProject` in `src/core/workspace/resolve.ts`. A hand-edited
 * `cwd` (moved repo) is found under its NEW path and keeps its stored `id`.
 */
export function findProjectByCwd(projects: ProjectRecord[], cwd: string): ProjectRecord | undefined {
  const target = path.resolve(cwd);
  return projects.find((p) => path.resolve(p.cwd) === target);
}

/**
 * True when `child` is the directory `parent` itself or lies under it (both
 * resolved). The one path-containment rule — "inside this home", "under this
 * root" — shared by the CLI resolution (`src/core/workspace/resolve.ts`), the
 * trust write (`trust-plugins.ts`) and the release shadow scope, so the rules
 * cannot drift apart.
 */
export function isPathWithin(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Every `(workspace, project)` whose `id` equals `id` — 0 or 1 per workspace,
 * 0/1/N across workspaces. The only project selector (`--project <id>`).
 */
export function findProjectsById(
  workspaces: WorkspaceRecord[],
  id: string,
): Array<{ workspace: WorkspaceRecord; project: ProjectRecord }> {
  const matches: Array<{ workspace: WorkspaceRecord; project: ProjectRecord }> = [];
  for (const workspace of workspaces) {
    const project = workspace.projects.find((p) => p.id === id);
    if (project) matches.push({ workspace, project });
  }
  return matches;
}

/**
 * The stored registry entry of a workspace this process serves is gone (another
 * process of this machine detached it after the view was taken). Registration
 * and removal refuse it the same way, before anything is written.
 * ASSUMPTION:dev-0603 — the routes answer it as 409 WORKSPACE_NOT_REGISTERED.
 */
export class WorkspaceEntryGoneError extends Error {
  readonly code = 'WORKSPACE_NOT_REGISTERED';
  constructor(name: string, file: string) {
    super(`workspace "${name}" no longer exists in ${file}`);
  }
}

/**
 * The stored entry a view was taken from: by name, with the same home (a
 * registry entry has none, so `undefined === undefined` there).
 */
function isStoredEntryOf(stored: StoredWorkspaceRecord, ws: WorkspaceRecord): boolean {
  return stored.name === ws.name && stored.home === ws.home;
}

export class RegistryMigrationPendingError extends Error {
  readonly code = 'REGISTRY_MIGRATION_PENDING';
  constructor(file: string) {
    super(`${file} still uses pre-2.1.0 hash project ids — start the claude4spec server once to migrate it`);
  }
}

/**
 * Effective workspace plugin package set = predefined ∪ user-added, deduped,
 * predefined first. This is what the M33 loader dynamic-imports at bootstrap.
 */
export function resolvePluginPackages(ws: Pick<WorkspaceRecord, 'plugins'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pkg of [...PREDEFINED_PLUGINS, ...(ws.plugins ?? [])]) {
    if (!seen.has(pkg)) {
      seen.add(pkg);
      out.push(pkg);
    }
  }
  return out;
}

/**
 * Most-recently-opened first; never-opened last, in registry order.
 *
 * Partitioned rather than sorted with a `?? ''` fallback, because `lastOpened`
 * is optional (`types.ts`) and an empty string only sorts below every ISO
 * timestamp by accident of the comparison. The rule the readers want stated is
 * "no timestamp means last, in file order", so it is stated. Shared by the two
 * places that order workspaces — the bare-start pick below and
 * `c4s list-workspaces` — so they cannot drift apart on the absent case.
 */
export function byLastOpenedDesc<T extends { lastOpened?: string }>(rows: readonly T[]): T[] {
  const opened = rows.filter((r) => r.lastOpened !== undefined);
  const neverOpened = rows.filter((r) => r.lastOpened === undefined);
  opened.sort((a, b) => b.lastOpened!.localeCompare(a.lastOpened!));
  return [...opened, ...neverOpened];
}

/**
 * Global registry root. `C4S_HOME` override exists for dev/E2E so a test run
 * never touches the real `~/.claude4spec/`.
 */
export function workspaceBaseDir(): string {
  return process.env.C4S_HOME ?? path.join(os.homedir(), '.claude4spec');
}

function nowIso(): string {
  return new Date().toISOString();
}

const WORKSPACE_NAME_RE = /^[a-zA-Z0-9._-]{1,40}$/;

function assertValidWorkspaceName(name: string): void {
  if (!WORKSPACE_NAME_RE.test(name) || name === '.' || name === '..') {
    throw new Error(
      `workspace name "${name}" invalid — 1-40 chars, allowed [a-zA-Z0-9._-] (it becomes a directory under ~/.claude4spec/)`,
    );
  }
}

/**
 * M31 / L1: single-file registry over `~/.claude4spec/workspaces.json`.
 * Every mutation re-reads the file under an advisory lock (`wx` lock file,
 * pid content, ~5s stale timeout) and writes atomically (tmp + rename), so
 * N concurrent server processes can share the registry.
 *
 * 2.1.58 (M31 `fjsgq19h`, `t97gncju`): an entry is either a REGISTRY workspace
 * (projects and plugins in the entry) or a workspace WITH A HOME (projects and
 * plugins in the committed `<home>/.claude4spec/workspace.json`, the entry
 * keeps only what belongs to the machine). Every read API returns the composed
 * VIEW. The home file is read once per registry instance and kept: a change
 * made from outside (`git pull`) applies from the next process start, while
 * this registry's own writes (registration, removal) update the view at once.
 *
 * A home file that does not validate refuses only the START of its own
 * workspace (`openView`) and the writes into it. Every other read keeps
 * answering: the broken entry reads with no projects and no plugins and carries
 * `fileError` (ASSUMPTION:dev-0103), so one broken repo never takes listing,
 * resolution or registration in the other workspaces down with it.
 */
export class WorkspaceRegistry {
  readonly baseDir: string;
  private readonly file: string;
  /**
   * The `workspace.json` of each home as this process sees it — or the refusal
   * reading it produced, kept as well (a broken file is not re-read on every
   * listing; like any outside change, its fix applies from the next start).
   */
  private readonly homeFiles = new Map<string, WorkspaceFile | WorkspaceFileError>();
  /** Homes whose directory was absent when their file failed to read (kept like the refusal). */
  private readonly missingHomes = new Set<string>();

  constructor(baseDir: string = workspaceBaseDir()) {
    this.baseDir = baseDir;
    this.file = path.join(baseDir, 'workspaces.json');
  }

  get filePath(): string {
    return this.file;
  }

  // ─── read API ─────────────────────────────────────────────────────────────

  listWorkspaces(): WorkspaceRecord[] {
    return this.read().workspaces.map((w) => this.compose(w));
  }

  getWorkspace(name: string): WorkspaceRecord | null {
    const stored = this.read().workspaces.find((w) => w.name === name);
    return stored ? this.compose(stored) : null;
  }

  findByPort(port: number): WorkspaceRecord | null {
    const stored = this.read().workspaces.find((w) => w.defaultPort === port);
    return stored ? this.compose(stored) : null;
  }

  /**
   * rev-0022: refuse a view whose stored entry is gone — BEFORE a caller touches
   * the project directory (the activation's file steps), so the refusal really
   * writes nothing. One raw read of `workspaces.json`: no view is composed (no
   * `workspace.json` read) and no migration is planned. Not a lock: the writes
   * re-check under the registry lock for a detach racing this call.
   */
  assertStoredEntry(ws: WorkspaceRecord): void {
    if (!this.readRaw().workspaces.some((w) => isStoredEntryOf(w, ws))) {
      throw new WorkspaceEntryGoneError(ws.name, this.file);
    }
  }

  getProject(ws: WorkspaceRecord, id: string): ProjectRecord | null {
    const fresh = this.getWorkspace(ws.name) ?? ws;
    return fresh.projects.find((p) => p.id === id) ?? null;
  }

  /**
   * Every workspace containing a project for this cwd (0/1/N rule for the CLI).
   * Matches the project path of each view — the stored `cwd` of a registry
   * record, or a `workspace.json` path resolved against `home` — so after a
   * hand-edited path the project resolves from its new directory with its
   * unchanged `id`. A caller that already holds the views passes them, so the
   * registry is not read a second time.
   */
  resolveWorkspacesForCwd(cwd: string, views: readonly WorkspaceRecord[] = this.listWorkspaces()): WorkspaceRecord[] {
    return views.filter((w) => findProjectByCwd(w.projects, cwd) !== undefined);
  }

  /**
   * 2.1.58 (M31 `vzkw903j`): the workspace's SLOTS DIRECTORY — owned here, not
   * by M41. Registry workspace: `~/.claude4spec/<workspace>/`; workspace with a
   * home: `<home>/.claude4spec/local/`. It also holds the `node_modules` of the
   * workspace's plugin packages (no clash: ids are `[a-z0-9-]` only).
   */
  slotsDir(ws: Pick<WorkspaceRecord, 'name' | 'home'>): string {
    return ws.home !== undefined ? homeLocalDir(ws.home) : path.join(this.baseDir, ws.name);
  }

  /**
   * The slots directory of every workspace in the registry, from the stored
   * entries alone (name / home) — no `workspace.json` is read.
   */
  listSlotsDirs(): string[] {
    return this.read().workspaces.map((w) => this.slotsDir(w));
  }

  /** DB slot of one project: `<slots directory>/<project-id>/`. */
  slotDir(ws: Pick<WorkspaceRecord, 'name' | 'home'>, projectId: string): string {
    return path.join(this.slotsDir(ws), projectId);
  }

  /**
   * The slot a context build opens its database in, with its continuity
   * checked (M31 `vzkw903j`). The slot records the directory it serves:
   *  - registry workspace — the marker is (re)pointed at `cwd`, so a hand-edited
   *    `cwd` (moved repo) keeps its slot and a later re-registration from the
   *    new directory recovers it;
   *  - workspace with a home — the `id` comes from `workspace.json`, never from a
   *    slot. A slot whose recorded directory differs from the view's path for
   *    this `id` is QUARANTINED: moved aside under `local/.quarantine/` (a name
   *    no minted id can take), neither assigned nor deleted, and the project
   *    starts on an empty slot. ASSUMPTION:dev-0102 — the quarantine is
   *    `local/.quarantine/<id>-<epoch ms>/`; the spec names no location.
   */
  prepareSlot(ws: WorkspaceRecord, projectId: string, cwd: string): string {
    const dir = this.slotDir(ws, projectId);
    if (ws.home !== undefined) {
      const marker = readSlotMarker(dir);
      if (marker !== null && path.resolve(marker.cwd) !== path.resolve(cwd)) {
        const quarantine = path.join(this.slotsDir(ws), '.quarantine');
        fs.mkdirSync(quarantine, { recursive: true });
        const target = path.join(quarantine, `${projectId}-${Date.now()}`);
        fs.renameSync(dir, target);
        console.warn(
          `[workspace] slot of project '${projectId}' belonged to ${marker.cwd}, not ${path.resolve(cwd)} — quarantined to ${target}; the project starts with an empty slot`,
        );
      }
    }
    writeSlotMarker(dir, cwd);
    return dir;
  }

  /**
   * 2.1.58 (M31 `ssn335r8`): build the workspace VIEW eagerly, before listen.
   * For a workspace with a home this ensures `<home>/.claude4spec/.gitignore`
   * carries `local/`, then reads and validates `workspace.json` — an unreadable
   * or malformed file, an entry without `id`, or a repeated `id` throws a
   * `WorkspaceFileError`, which refuses the start. A registry workspace has
   * nothing to compose. The file is read once: a read this instance already
   * made (or its refusal) is reused, never repeated.
   */
  openView(name: string): WorkspaceRecord {
    const stored = this.read().workspaces.find((w) => w.name === name);
    if (!stored) throw new Error(`workspace "${name}" does not exist in ${this.file}`);
    if (stored.home !== undefined) {
      ensureHomeGitignore(stored.home);
      this.homeFile(stored.home);
    }
    return this.compose(stored);
  }

  // ─── mutations ────────────────────────────────────────────────────────────

  /** `selectOrCreateEntry`, composed into the view. */
  selectOrCreate(sel: WorkspaceSelection = {}): WorkspaceRecord {
    return this.compose(this.selectOrCreateEntry(sel));
  }

  /**
   * 2.1.58 (M31 `m31wsel01`, flag combinations `qglsgonq`): the start's
   * workspace selection rule, first match wins —
   *  1. `--workspace <name>` selects (or creates a registry entry of) that name;
   *     with `--cwd` the combination table decides;
   *  2. `--cwd <dir>` names the workspace HOME: `$HOME` → `default`; the `home`
   *     of an entry → that entry; otherwise a new entry with that home (the
   *     directory created when absent), named by `--workspace` or the directory
   *     name (`-2`, `-3`… on a collision); a project directory is refused
   *     (`CWD_IS_PROJECT`), a directory inside another home too (`CWD_INSIDE_HOME`);
   *  3. `--port <n>` alone selects the entry with that `defaultPort`, or creates
   *     a registry entry (`default`, else `ws-<port>`);
   *  4. the bare command only: the walk-up from the launch directory to the
   *     first `.claude4spec/workspace.json` selects the entry with that home,
   *     created as in 2 when there is none;
   *  5. otherwise the sole entry, else `default`, else the most recently opened
   *     — homes whose directory is gone are skipped in 4–5; with no candidate
   *     left, a new registry entry `default` (`ws-<port>` when a skipped entry
   *     holds that name — the first free port whose `ws-<port>` name is free
   *     too). No path creates a second entry with a taken name.
   *
   * With `--workspace` or `--cwd`, `--port` overrides and persists the selected
   * entry's `defaultPort`; a port that is another entry's `defaultPort` is
   * refused (`PORT_TAKEN_BY_WORKSPACE`). A new entry without `--port` gets the
   * first free port from 4500 among the entries; `--mode` seeds a new entry
   * only. Every refusal is raised before anything is written.
   *
   * The stored entry only, so no `workspace.json` is read: the start
   * (`openStartWorkspace` in `src/bin/launch.ts`) leaves the single eager read
   * of the home file to `openView`, after `.gitignore` is ensured.
   */
  selectOrCreateEntry(sel: WorkspaceSelection = {}): StoredWorkspaceRecord {
    if (sel.name != null) assertValidWorkspaceName(sel.name);
    const userHome = path.resolve(sel.userHome ?? os.homedir());
    const bare = sel.name == null && sel.cwd === undefined && sel.port == null;
    const homeDir =
      sel.cwd !== undefined
        ? path.resolve(sel.cwd)
        : bare && sel.launchDir !== undefined
          ? (findWorkspaceHomeUp(sel.launchDir) ?? undefined)
          : undefined;
    // `--port` is an override only when `--workspace` / `--cwd` select the entry.
    const override = sel.name != null || sel.cwd !== undefined ? sel.port : undefined;
    return this.withLock((data) => {
      const assertPortFree = (port: number, self: string | null) => {
        const owner = data.workspaces.find((w) => w.name !== self && w.defaultPort === port);
        if (owner) {
          throw new WorkspaceSelectionError(
            'PORT_TAKEN_BY_WORKSPACE',
            `port ${port} is the port of workspace '${owner.name}'`,
            `pass another --port, or start workspace '${owner.name}' with --workspace ${owner.name}`,
          );
        }
      };
      const create = (name: string, port: number | undefined, home?: string): StoredWorkspaceRecord => {
        assertValidWorkspaceName(name);
        // Workspace identity is the name: a second entry with it would shadow the first.
        if (data.workspaces.some((w) => w.name === name)) {
          throw new Error(`workspace "${name}" already exists — pass --workspace ${name} explicitly`);
        }
        if (port !== undefined) assertPortFree(port, null);
        const rec: StoredWorkspaceRecord = {
          name,
          ...(home !== undefined ? { home } : {}),
          mode: sel.mode ?? 'prod',
          defaultPort: port ?? firstFreePort(data.workspaces, DEFAULT_WORKSPACE_PORT),
          lastOpened: nowIso(),
          ...(home !== undefined ? {} : { projects: [] }),
        };
        // The home and its description exist before the entry naming them is written.
        if (home !== undefined) ensureHomeDescription(home);
        data.workspaces.push(rec);
        return rec;
      };

      let ws: StoredWorkspaceRecord | undefined;
      if (homeDir !== undefined) {
        const found = this.entryForHome(data, homeDir, sel.name, userHome);
        ws = 'existing' in found ? found.existing : create(found.name, override, found.home);
      } else if (sel.name != null) {
        ws = data.workspaces.find((w) => w.name === sel.name) ?? create(sel.name, override);
      } else if (sel.port != null) {
        ws = data.workspaces.find((w) => w.defaultPort === sel.port);
        if (!ws) {
          const name = data.workspaces.some((w) => w.name === DEFAULT_WORKSPACE_NAME)
            ? `ws-${sel.port}`
            : DEFAULT_WORKSPACE_NAME;
          ws = create(name, sel.port);
        }
      } else {
        // Step 5: reuse the obvious workspace instead of proliferating; a home
        // whose directory is gone is no candidate.
        const candidates = data.workspaces.filter((w) => w.home === undefined || fs.existsSync(w.home));
        ws =
          candidates.length === 1
            ? candidates[0]
            : (candidates.find((w) => w.name === DEFAULT_WORKSPACE_NAME) ?? byLastOpenedDesc(candidates)[0]);
        if (!ws) {
          // No candidate: a new registry workspace, named `default` — or, when the
          // skipped entries hold that name, `ws-<port>` as in step 3, on the first
          // free port whose `ws-<port>` name is free too (an entry may keep such a
          // name after moving to another port).
          // ASSUMPTION:dev-0507 — the skipped `default` is never reused or replaced.
          const nameTaken = (n: string) => data.workspaces.some((w) => w.name === n);
          let port = firstFreePort(data.workspaces, DEFAULT_WORKSPACE_PORT);
          if (nameTaken(DEFAULT_WORKSPACE_NAME)) {
            while (nameTaken(`ws-${port}`)) port = firstFreePort(data.workspaces, port + 1);
            ws = create(`ws-${port}`, port);
          } else {
            ws = create(DEFAULT_WORKSPACE_NAME, port);
          }
        }
      }
      if (override !== undefined && ws.defaultPort !== override) {
        assertPortFree(override, ws.name);
        ws.defaultPort = override;
      }
      ws.lastOpened = nowIso();
      return ws;
    });
  }

  /**
   * Steps 2 and 4 of the selection rule for one home directory (resolved),
   * with the `--workspace` name when given: the entry it selects, or the entry
   * to create. Throws the combination table's refusals; writes nothing.
   */
  private entryForHome(
    data: WorkspacesFile,
    dir: string,
    name: string | undefined,
    userHome: string,
  ): { existing: StoredWorkspaceRecord } | { name: string; home?: string } {
    const byName = (n: string) => data.workspaces.find((w) => w.name === n);
    if (dir === userHome) {
      if (name != null && name !== DEFAULT_WORKSPACE_NAME) {
        throw new WorkspaceSelectionError(
          'WORKSPACE_HOME_MISMATCH',
          `--cwd ${dir} is your home directory, which selects workspace '${DEFAULT_WORKSPACE_NAME}', not '${name}'`,
          `drop --cwd to start workspace '${name}', or pass --workspace ${DEFAULT_WORKSPACE_NAME}`,
        );
      }
      const existing = byName(DEFAULT_WORKSPACE_NAME);
      return existing ? { existing } : { name: DEFAULT_WORKSPACE_NAME };
    }
    const isHomeOf = (w: StoredWorkspaceRecord) => w.home !== undefined && path.resolve(w.home) === dir;
    const owner = data.workspaces.find(isHomeOf);
    if (name != null) {
      const named = byName(name);
      if (named) {
        if (isHomeOf(named)) return { existing: named };
        throw new WorkspaceSelectionError(
          'WORKSPACE_HOME_MISMATCH',
          named.home !== undefined
            ? `workspace '${name}' has the home ${named.home}, not ${dir}`
            : `workspace '${name}' is a registry workspace — it has no home directory, so --cwd ${dir} cannot select it`,
          named.home !== undefined
            ? `pass --cwd ${named.home}, or drop --cwd to start workspace '${name}'`
            : `drop --cwd to start workspace '${name}', or pass another --workspace name to create a workspace with the home ${dir}`,
        );
      }
      // ASSUMPTION:dev-0504 — a new name over a directory that already is a home is refused too.
      if (owner) {
        throw new WorkspaceSelectionError(
          'WORKSPACE_HOME_MISMATCH',
          `${dir} is already the home of workspace '${owner.name}'`,
          `pass --workspace ${owner.name}, or drop --workspace`,
        );
      }
    } else if (owner) {
      return { existing: owner };
    }
    const enclosing = data.workspaces.find((w) => w.home !== undefined && isPathWithin(w.home, dir));
    if (isProjectDirectory(dir)) {
      const hint = repositoryHintFor(dir, enclosing?.home);
      throw new WorkspaceSelectionError(
        'CWD_IS_PROJECT',
        `${dir} is a project directory (it has .claude4spec/config.json) — a workspace home is not a project`,
        `pass the repository directory instead: --cwd ${hint}`,
      );
    }
    if (enclosing) {
      throw new WorkspaceSelectionError(
        'CWD_INSIDE_HOME',
        `${dir} lies inside the home of workspace '${enclosing.name}' (${enclosing.home})`,
        `pass --cwd ${enclosing.home}`,
      );
    }
    return { name: name ?? homeEntryName(dir, new Set(data.workspaces.map((w) => w.name))), home: dir };
  }

  /**
   * Idempotent: registers cwd into the workspace, creates the DB slot dir.
   *
   * Registry workspace — 2.1.0 id resolution, in order:
   *  1. a live record for this directory → reused as-is (id never recomputed);
   *  2. a slot in this workspace that belongs to this directory (a detached
   *     project) → its id is recovered, and so is the index in it;
   *  3. otherwise a fresh id minted from `config.json` `name` (an
   *     absent/unreadable config falls back to the directory name), unique
   *     against live ids AND every slot directory — a new project named like
   *     a detached one gets a suffix, never its slot.
   * Minting happens under the registry lock, whoever registers (server or
   * `c4s trust-plugins`).
   *
   * Workspace with a home (2.1.58, M31 `fzno8pd4`, `zovs1ohc`): the record goes
   * to `workspace.json` — `id` + path relative to `home` — under that file's
   * advisory lock. An entry with the same path is reused; otherwise the id is
   * minted unique within `workspace.json`, from committed content only (no
   * slots: they are per machine), so the whole team addresses the project by
   * the same id. The in-memory view is updated at once.
   *
   * The kind is taken from the view passed in (`ws.home`) — no registry read.
   */
  registerProject(ws: WorkspaceRecord, cwd: string): ProjectRecord {
    const absCwd = path.resolve(cwd);
    if (ws.home !== undefined) return this.registerHomeProject(ws, absCwd);
    const wsDir = path.join(this.baseDir, ws.name);
    const project = this.withLock((data) => {
      const target = data.workspaces.find((w) => isStoredEntryOf(w, ws));
      if (!target) throw new WorkspaceEntryGoneError(ws.name, this.file);
      const projects = (target.projects ??= []);
      let p = findProjectByCwd(projects, absCwd);
      if (!p) {
        const live = new Set(projects.map((x) => x.id));
        const recovered = findSlotIdForCwd(wsDir, absCwd);
        const name = readPeerConfigSummary(absCwd).name;
        const id =
          recovered && !live.has(recovered)
            ? recovered
            : mintProjectId(
                name && name.trim() !== '' ? name : path.basename(absCwd),
                new Set([...live, ...listSlotIds(wsDir)]),
              );
        p = { cwd: absCwd, id, addedAt: nowIso() };
        projects.push(p);
      }
      return p;
    });
    writeSlotMarker(this.slotDir(ws, project.id), project.cwd);
    return project;
  }

  private registerHomeProject(ws: WorkspaceRecord, absCwd: string): ProjectRecord {
    const home = ws.home!;
    // Both refusals (PROJECT_PATH_IS_HOME / PROJECT_PATH_OUTSIDE_HOME) before any write.
    const rel = toProjectPath(home, absCwd);
    // This process's view already lists the path (the start's own view, or an
    // earlier write here): nothing to write, so `workspace.json` is not read a
    // second time — an outside change applies from the next start anyway.
    const seen = this.homeFiles.get(home);
    const listed =
      seen && !(seen instanceof WorkspaceFileError)
        ? seen.projects.find((p) => path.resolve(home, p.path) === absCwd)
        : undefined;
    if (listed) {
      this.prepareSlot(ws, listed.id, absCwd);
      return ws.projects.find((p) => p.id === listed.id && path.resolve(p.cwd) === absCwd) ?? { id: listed.id, cwd: absCwd };
    }
    // rev-0006: the committed file is written only while this machine still has
    // the entry — under the registry lock, so a view held since before a detach
    // of the workspace cannot write into its `workspace.json`.
    const id = this.withStoredHomeEntry(ws, () => {
      const { file, result } = mutateWorkspaceFile(home, (data) => {
        const existing = data.projects.find((p) => path.resolve(home, p.path) === absCwd);
        if (existing) return { next: null, result: existing.id };
        const name = readPeerConfigSummary(absCwd).name;
        const minted = mintProjectId(
          name && name.trim() !== '' ? name : path.basename(absCwd),
          new Set(data.projects.map((p) => p.id)),
        );
        return { next: { ...data, projects: [...data.projects, { id: minted, path: rel }] }, result: minted };
      });
      this.homeFiles.set(home, file);
      return result;
    });
    this.prepareSlot(ws, id, absCwd);
    // The caller's view already folds in the machine-local trust of a project
    // it lists under this path; a newly minted project has none yet.
    return ws.projects.find((p) => p.id === id && path.resolve(p.cwd) === absCwd) ?? { id, cwd: absCwd };
  }

  /**
   * Registry workspace: drop the record. Workspace with a home: drop the entry
   * from `workspace.json` (under its lock; the view follows at once) and the
   * project's machine-local trust from the registry entry. `false` = the id is
   * not a project of the workspace. A workspace whose stored entry is gone is
   * refused like the registration (`WorkspaceEntryGoneError`), nothing written.
   */
  removeProject(ws: WorkspaceRecord, id: string): boolean {
    if (ws.home !== undefined) {
      const home = ws.home;
      // Under the registry lock, like the registration: an entry this machine
      // no longer has does not get its committed file rewritten (rev-0021).
      return this.withLock((data) => {
        const target = data.workspaces.find((w) => isStoredEntryOf(w, ws));
        if (!target) throw new WorkspaceEntryGoneError(ws.name, this.file);
        const { file, result } = mutateWorkspaceFile(home, (current) => {
          const projects = current.projects.filter((p) => p.id !== id);
          return projects.length < current.projects.length
            ? { next: { ...current, projects }, result: true }
            : { next: null, result: false };
        });
        this.homeFiles.set(home, file);
        if (target.projectTrust) delete target.projectTrust[id];
        return result;
      });
    }
    return this.withLock((data) => {
      const target = data.workspaces.find((w) => isStoredEntryOf(w, ws));
      if (!target) throw new WorkspaceEntryGoneError(ws.name, this.file);
      if (!target.projects) return false;
      const before = target.projects.length;
      target.projects = target.projects.filter((p) => p.id !== id);
      return target.projects.length < before;
    });
  }

  touchLastOpened(wsName: string, projectId?: string): void {
    this.withLock((data) => {
      const ws = data.workspaces.find((w) => w.name === wsName);
      if (!ws) return null;
      ws.lastOpened = nowIso();
      if (projectId) {
        ws.lastOpenedProject = projectId;
        const p = ws.projects?.find((x) => x.id === projectId);
        if (p) p.lastOpened = nowIso();
      }
      return null;
    });
  }

  /**
   * M33 phase 2: read the machine-local plugin-trust decision for one project.
   * `undefined` = undecided (the loader shows a trust prompt on first open).
   * For a workspace with a home, a consent given under another project path
   * reads as undecided (folded in by the view, see `compose`).
   */
  getProjectTrust(ws: WorkspaceRecord, id: string): boolean | undefined {
    return this.getProject(ws, id)?.trustProjectPlugins;
  }

  /**
   * M33 phase 2: persist the plugin-trust decision per `(workspace × project)`.
   * Lives in `~/.claude4spec/workspaces.json`, NEVER in the repo (nor in
   * `workspace.json`). The caller is expected to trigger a `ProjectContext`
   * rebuild so the overlay (un)loads without a process restart.
   */
  setProjectTrust(ws: WorkspaceRecord, id: string, value: boolean): void {
    this.setTrustFlag(ws, id, 'trustProjectPlugins', value);
  }

  /**
   * 2.1.57 (M31 `44viw74p`, M52 `ybbal0vf`): whether this machine confirmed the
   * skill attachments of the project's committed config. Read live by the
   * `project-exposed` skill source on every registry query. ASSUMPTION:dev-0002.
   */
  getSpecSkillHooksTrust(ws: WorkspaceRecord, id: string): boolean {
    return this.getProject(ws, id)?.trustSpecSkillHooks === true;
  }

  /**
   * 2.1.57: persist the skill-attachment confirmation per `(workspace × project)`
   * in `~/.claude4spec/workspaces.json`, NEVER in the repo, next to
   * `trustProjectPlugins`. No context rebuild: the source reads it live, and the
   * listing of a thread is frozen anyway (from the next thread on).
   * ASSUMPTION:dev-0002 — one confirmation for the whole attachment list.
   */
  setSpecSkillHooksTrust(ws: WorkspaceRecord, id: string, value: boolean): void {
    this.setTrustFlag(ws, id, 'trustSpecSkillHooks', value);
  }

  /**
   * One write path for both machine-local consents. Registry workspace: the
   * flag on the `ProjectRecord`. Workspace with a home (M31 `44viw74p`): the
   * entry's `projectTrust[id]`, stored together with the project's relative
   * path in the view; a record left from another path is replaced, not merged,
   * so no consent given for other code survives the move.
   */
  private setTrustFlag(
    ws: WorkspaceRecord,
    id: string,
    key: 'trustProjectPlugins' | 'trustSpecSkillHooks',
    value: boolean,
  ): void {
    const viewPath = ws.home !== undefined ? this.homeFile(ws.home).projects.find((p) => p.id === id)?.path : undefined;
    this.withLock((data) => {
      const target = data.workspaces.find((w) => w.name === ws.name);
      if (!target) return null;
      if (target.home === undefined) {
        const p = target.projects?.find((x) => x.id === id);
        if (p) p[key] = value;
        return null;
      }
      if (viewPath === undefined) return null;
      const trust = (target.projectTrust ??= {});
      const current = trust[id];
      const base: HomeProjectTrust =
        current && sameProjectPath(current.path, viewPath) ? current : { path: viewPath };
      trust[id] = { ...base, path: viewPath, [key]: value };
      return null;
    });
  }

  /**
   * 2.1.0: persist `--host` / `--public-url` on a workspace. `undefined` leaves
   * a field untouched; `''` removes it (back to the default: loopback /
   * `http://localhost:<defaultPort>`). Callers validate `publicUrl` first.
   * Returns the stored entry — no view is composed, so no `workspace.json` is
   * read (the start sets these before its single eager read in `openView`).
   */
  setNetwork(wsName: string, net: { bindHost?: string; publicUrl?: string }): StoredWorkspaceRecord | null {
    return this.withLock((data) => {
      const ws = data.workspaces.find((w) => w.name === wsName);
      if (!ws) return null;
      if (net.bindHost !== undefined) {
        if (net.bindHost === '') delete ws.bindHost;
        else ws.bindHost = net.bindHost;
      }
      if (net.publicUrl !== undefined) {
        if (net.publicUrl === '') delete ws.publicUrl;
        else ws.publicUrl = net.publicUrl;
      }
      return ws;
    });
  }

  /** True while the file on disk still carries pre-2.1.0 hash ids. */
  isMigrationPending(): boolean {
    return isMigrationPendingFor(this.readRaw());
  }

  /**
   * 2.1.0: hash ids → readable ids, run by the server at start, before listen,
   * under the advisory lock. Per project: write the slot marker into the hash
   * slot → rename `<ws>/<hash>/` → `<ws>/<id>/`; then write the registry as v3.
   * Every step is detectable from disk, so a run interrupted after any rename
   * is completed by the next start (the renamed slot's marker names its
   * directory, and the plan adopts it). Detached projects' slots are left as
   * they are and recovered by their directory on re-registration. Entries with
   * a home are not touched (M31 `9yq1j7e8`).
   */
  migrateIfNeeded(): ProjectIdRename[] {
    fs.mkdirSync(this.baseDir, { recursive: true });
    return withAdvisoryLock(this.lockPath(), () => {
      const data = this.readRaw();
      if (!isMigrationPendingFor(data)) return [];
      const { file, renames } = planRegistryMigration(data, this.baseDir);
      for (const r of renames) {
        const from = path.join(this.baseDir, r.workspace, r.from);
        const to = path.join(this.baseDir, r.workspace, r.to);
        if (fs.existsSync(from) && !fs.existsSync(to)) {
          writeSlotMarker(from, r.cwd);
          fs.renameSync(from, to);
        } else if (fs.existsSync(to)) {
          writeSlotMarker(to, r.cwd);
        }
      }
      writeJsonAtomic(this.file, file);
      return renames;
    });
  }

  /**
   * Carry of config-v3 harvested values — first-wins: only fills the workspace
   * when registry creation predated knowing them. A dropped port logs a warn.
   */
  carryDefaults(wsName: string, carried: { defaultPort?: number; mode?: 'dev' | 'prod' }): void {
    if (carried.defaultPort == null && carried.mode == null) return;
    this.withLock((data) => {
      const ws = data.workspaces.find((w) => w.name === wsName);
      if (!ws) return null;
      if (carried.defaultPort != null && ws.defaultPort !== carried.defaultPort) {
        if (ws.defaultPort === DEFAULT_WORKSPACE_PORT && !this.portTakenUnsafe(data, carried.defaultPort, wsName)) {
          ws.defaultPort = carried.defaultPort;
        } else {
          console.warn(
            `[workspace] dropped carried port ${carried.defaultPort} — workspace "${wsName}" already has defaultPort ${ws.defaultPort}`,
          );
        }
      }
      return null;
    });
  }

  private portTakenUnsafe(data: WorkspacesFile, port: number, exceptName: string): boolean {
    return data.workspaces.some((w) => w.name !== exceptName && w.defaultPort === port);
  }

  // ─── view ────────────────────────────────────────────────────────────────

  /**
   * A home's `workspace.json` as this process sees it (read once, then kept),
   * or the `WorkspaceFileError` reading it produced — kept too.
   */
  private homeFileOrError(home: string): WorkspaceFile | WorkspaceFileError {
    let file = this.homeFiles.get(home);
    if (!file) {
      try {
        file = readWorkspaceFile(home);
      } catch (err) {
        if (!(err instanceof WorkspaceFileError)) throw err;
        file = err;
        // Probed only on the failure path: a missing directory is a moved or
        // deleted checkout, not a broken file (M31 `459ucmfg` `home-missing`).
        if (!fs.existsSync(home)) this.missingHomes.add(home);
      }
      this.homeFiles.set(home, file);
    }
    return file;
  }

  /** The strict read: the start (`openView`) and writes into the file refuse on a broken one. */
  private homeFile(home: string): WorkspaceFile {
    const file = this.homeFileOrError(home);
    if (file instanceof WorkspaceFileError) throw file;
    return file;
  }

  /**
   * Registry entry → view. A registry entry IS its view. An entry with a home
   * takes `projects` and `plugins` from `workspace.json`; each project's cwd is
   * its path resolved against `home`, and its trust is the entry's consent for
   * that id ONLY while it was given under the same relative path — otherwise
   * the project reads as undecided (M31 `44viw74p`).
   *
   * A `workspace.json` that does not validate does not throw here: the entry
   * reads with no projects and no plugins and carries `fileError`
   * (ASSUMPTION:dev-0103). Only `openView` — the start of that workspace —
   * and the writes into the file refuse on it.
   */
  private compose(stored: StoredWorkspaceRecord): WorkspaceRecord {
    const { projectTrust, projects, ...entry } = stored;
    if (stored.home === undefined) return { ...entry, projects: projects ?? [] };
    const home = stored.home;
    const file = this.homeFileOrError(home);
    if (file instanceof WorkspaceFileError) {
      return {
        ...entry,
        plugins: [],
        projects: [],
        fileError: { code: file.code, message: file.message },
        ...(this.missingHomes.has(home) ? { homeMissing: true as const } : {}),
      };
    }
    return {
      ...entry,
      plugins: [...file.plugins],
      projects: file.projects.map((p) => {
        const record: ProjectRecord = { id: p.id, cwd: path.resolve(home, p.path) };
        const trust = projectTrust?.[p.id];
        if (trust && sameProjectPath(trust.path, p.path)) {
          if (trust.trustProjectPlugins !== undefined) record.trustProjectPlugins = trust.trustProjectPlugins;
          if (trust.trustSpecSkillHooks !== undefined) record.trustSpecSkillHooks = trust.trustSpecSkillHooks;
        }
        return record;
      }),
    };
  }

  // ─── persistence ─────────────────────────────────────────────────────────

  /**
   * Registry as callers see it: a pre-2.1.0 file is presented with its ids
   * migrated IN MEMORY (read-only CLI commands never migrate the file).
   */
  private read(): WorkspacesFile {
    const data = this.readRaw();
    return isMigrationPendingFor(data) ? planRegistryMigration(data, this.baseDir).file : data;
  }

  private readRaw(): WorkspacesFile {
    // 0.2.65: the read is ATTEMPTED, not pre-checked with `existsSync`.
    // `existsSync` answers false for two very different situations — the file
    // is absent, and the file cannot be reached because its directory is
    // unreadable (`~/.claude4spec` at mode 000, a root-owned home). Collapsing
    // them made `c4s list-workspaces` answer `[]` with exit 0 on a machine that
    // has workspaces, i.e. report "fresh machine" for "I am not allowed to
    // look". Only ENOENT is an empty registry; a permission or path error is a
    // read failure and propagates to REGISTRY_READ_FAILED.
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { $schemaVersion: WORKSPACES_SCHEMA_VERSION, workspaces: [] };
      }
      throw new Error(`${this.file}: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`${this.file}: invalid JSON — ${(err as Error).message}`);
    }
    const data = parsed as WorkspacesFile;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.workspaces)) {
      throw new Error(`${this.file}: expected { $schemaVersion, workspaces: [] }`);
    }
    // 2.1.12 (M31 edge cases): a damaged RECORD is a damaged registry. Without
    // this a workspace whose `projects` is not an array read through — a string
    // answered `.length`, so `c4s list-workspaces` printed the intact records
    // plus a garbage one instead of refusing: a partial answer is worse than none.
    // 2.1.58: an entry with a home is recognised by an absolute `home` and
    // carries no `projects` (its composition lives in `workspace.json`).
    data.workspaces.forEach((w, i) => {
      const rec = w as unknown as Record<string, unknown> | null;
      const base = typeof rec === 'object' && rec !== null && typeof rec.name === 'string' && typeof rec.defaultPort === 'number';
      const ok =
        base &&
        (rec!.home !== undefined
          ? typeof rec!.home === 'string' && path.isAbsolute(rec!.home) && rec!.projects === undefined
          : Array.isArray(rec!.projects) &&
            (rec!.projects as unknown[]).every(
              (p) => typeof p === 'object' && p !== null && typeof (p as { cwd?: unknown }).cwd === 'string',
            ));
      if (!ok) throw new Error(`${this.file}: workspaces[${i}] is not a workspace record`);
    });
    if (typeof data.$schemaVersion === 'number' && data.$schemaVersion > WORKSPACES_SCHEMA_VERSION) {
      throw new Error(
        `${this.file}: schema version ${data.$schemaVersion} not supported by this claude4spec version`,
      );
    }
    return data;
  }

  private lockPath(): string {
    return this.file + '.lock';
  }

  /**
   * Run `fn` under the registry lock while the stored entry of `ws` — by name,
   * with the same home — still exists; refuse otherwise. The registry is only
   * read here, never rewritten: `fn` writes the home's own file.
   */
  private withStoredHomeEntry<T>(ws: WorkspaceRecord, fn: () => T): T {
    fs.mkdirSync(this.baseDir, { recursive: true });
    return withAdvisoryLock(this.lockPath(), () => {
      const stored = this.readRaw().workspaces.find((w) => isStoredEntryOf(w, ws));
      if (!stored) throw new WorkspaceEntryGoneError(ws.name, this.file);
      return fn();
    });
  }

  /** Re-read under lock → mutate → atomic write. Returns the mutator's value. */
  private withLock<T>(mutate: (data: WorkspacesFile) => T): T {
    fs.mkdirSync(this.baseDir, { recursive: true });
    return withAdvisoryLock(this.lockPath(), () => {
      const data = this.readRaw();
      // Writing would persist ids nobody migrated the slots for — the server
      // migrates first (`migrateIfNeeded`), the CLI refuses.
      if (isMigrationPendingFor(data)) throw new RegistryMigrationPendingError(this.file);
      data.$schemaVersion = WORKSPACES_SCHEMA_VERSION;
      const result = mutate(data);
      writeJsonAtomic(this.file, data);
      return result;
    });
  }
}
