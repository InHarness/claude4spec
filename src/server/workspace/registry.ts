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
import { findSlotIdForCwd, listSlotIds, writeSlotMarker } from './slot-marker.js';
import type { ProjectRecord, WorkspaceRecord, WorkspacesFile } from './types.js';

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
const LOCK_STALE_MS = 5_000;

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

/** DB slot of one project inside one workspace: `~/.claude4spec/<ws>/<id>/`. */
export function slotDirFor(workspaceName: string, projectId: string): string {
  return path.join(workspaceBaseDir(), workspaceName, projectId);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
 */
export class WorkspaceRegistry {
  readonly baseDir: string;
  private readonly file: string;

  constructor(baseDir: string = workspaceBaseDir()) {
    this.baseDir = baseDir;
    this.file = path.join(baseDir, 'workspaces.json');
  }

  get filePath(): string {
    return this.file;
  }

  // ─── read API ─────────────────────────────────────────────────────────────

  listWorkspaces(): WorkspaceRecord[] {
    return this.read().workspaces;
  }

  getWorkspace(name: string): WorkspaceRecord | null {
    return this.read().workspaces.find((w) => w.name === name) ?? null;
  }

  findByPort(port: number): WorkspaceRecord | null {
    return this.read().workspaces.find((w) => w.defaultPort === port) ?? null;
  }

  getProject(ws: WorkspaceRecord, id: string): ProjectRecord | null {
    const fresh = this.getWorkspace(ws.name) ?? ws;
    return fresh.projects.find((p) => p.id === id) ?? null;
  }

  /**
   * Every workspace containing a project for this cwd (0/1/N rule for the CLI).
   * Matches the stored `cwd` field, so after a hand-edited `cwd` the project
   * resolves from its new directory with its unchanged `id`.
   */
  resolveWorkspacesForCwd(cwd: string): WorkspaceRecord[] {
    return this.read().workspaces.filter((w) => findProjectByCwd(w.projects, cwd) !== undefined);
  }

  slotDir(ws: WorkspaceRecord, projectId: string): string {
    return path.join(this.baseDir, ws.name, projectId);
  }

  // ─── mutations ────────────────────────────────────────────────────────────

  /**
   * Workspace identity = name. Selection order: explicit `name` → workspace
   * owning `port` as defaultPort → sole/default workspace → create. `port`
   * persists as `defaultPort` only at creation (first-wins; an existing
   * workspace's defaultPort is never overwritten here).
   */
  selectOrCreate(opts: { name?: string; port?: number; mode?: 'dev' | 'prod' } = {}): WorkspaceRecord {
    if (opts.name != null) assertValidWorkspaceName(opts.name);
    return this.withLock((data) => {
      let ws: WorkspaceRecord | undefined;
      if (opts.name != null) {
        ws = data.workspaces.find((w) => w.name === opts.name);
      } else if (opts.port != null) {
        ws = data.workspaces.find((w) => w.defaultPort === opts.port);
      }
      if (!ws && opts.name == null && opts.port == null) {
        // Bare start: reuse the obvious workspace instead of proliferating.
        ws =
          data.workspaces.length === 1
            ? data.workspaces[0]
            : data.workspaces.find((w) => w.name === DEFAULT_WORKSPACE_NAME) ??
              byLastOpenedDesc(data.workspaces)[0];
      }
      if (!ws) {
        let name = opts.name ?? DEFAULT_WORKSPACE_NAME;
        if (opts.name == null && data.workspaces.some((w) => w.name === name)) {
          name = `ws-${opts.port ?? DEFAULT_WORKSPACE_PORT}`;
        }
        if (data.workspaces.some((w) => w.name === name)) {
          throw new Error(
            `workspace "${name}" already exists with a different port — pass --workspace <name> explicitly`,
          );
        }
        assertValidWorkspaceName(name);
        ws = {
          name,
          mode: opts.mode ?? 'prod',
          defaultPort: opts.port ?? DEFAULT_WORKSPACE_PORT,
          lastOpened: nowIso(),
          projects: [],
        };
        data.workspaces.push(ws);
      } else {
        ws.lastOpened = nowIso();
      }
      return ws;
    });
  }

  /**
   * Idempotent: registers cwd into the workspace, creates the DB slot dir.
   *
   * 2.1.0 id resolution, in order:
   *  1. a live record for this directory → reused as-is (id never recomputed);
   *  2. a slot in this workspace that belongs to this directory (a detached
   *     project) → its id is recovered, and so is the index in it;
   *  3. otherwise a fresh id minted from `config.json` `name` (`seed.name`
   *     overrides it; an absent/unreadable config falls back to the directory
   *     name), unique against live ids AND every slot directory — a
   *     new project named like a detached one gets a suffix, never its slot.
   * Minting happens under the registry lock, whoever registers (server or
   * `c4s trust-plugins`).
   */
  registerProject(ws: WorkspaceRecord, cwd: string, seed: { name?: string } = {}): ProjectRecord {
    const absCwd = path.resolve(cwd);
    const wsDir = path.join(this.baseDir, ws.name);
    const project = this.withLock((data) => {
      const target = data.workspaces.find((w) => w.name === ws.name);
      if (!target) throw new Error(`workspace "${ws.name}" no longer exists in ${this.file}`);
      let p = findProjectByCwd(target.projects, absCwd);
      if (!p) {
        const live = new Set(target.projects.map((x) => x.id));
        const recovered = findSlotIdForCwd(wsDir, absCwd);
        const name = seed.name ?? readPeerConfigSummary(absCwd).name;
        const id =
          recovered && !live.has(recovered)
            ? recovered
            : mintProjectId(
                name && name.trim() !== '' ? name : path.basename(absCwd),
                new Set([...live, ...listSlotIds(wsDir)]),
              );
        p = { cwd: absCwd, id, addedAt: nowIso() };
        target.projects.push(p);
      }
      return p;
    });
    writeSlotMarker(this.slotDir(ws, project.id), project.cwd);
    return project;
  }

  removeProject(ws: WorkspaceRecord, id: string): boolean {
    return this.withLock((data) => {
      const target = data.workspaces.find((w) => w.name === ws.name);
      if (!target) return false;
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
        const p = ws.projects.find((x) => x.id === projectId);
        if (p) p.lastOpened = nowIso();
      }
      return null;
    });
  }

  /**
   * M33 phase 2: read the machine-local plugin-trust decision for one project.
   * `undefined` = undecided (the loader shows a trust prompt on first open).
   */
  getProjectTrust(ws: WorkspaceRecord, id: string): boolean | undefined {
    return this.getProject(ws, id)?.trustProjectPlugins;
  }

  /**
   * M33 phase 2: persist the plugin-trust decision per `(workspace × project)`.
   * Lives in `~/.claude4spec/workspaces.json`, NEVER in the repo. The caller is
   * expected to trigger a `ProjectContext` rebuild so the overlay (un)loads
   * without a process restart.
   */
  setProjectTrust(ws: WorkspaceRecord, id: string, value: boolean): void {
    this.withLock((data) => {
      const target = data.workspaces.find((w) => w.name === ws.name);
      if (!target) return null;
      const p = target.projects.find((x) => x.id === id);
      if (p) p.trustProjectPlugins = value;
      return null;
    });
  }

  /**
   * 2.1.0: persist `--host` / `--public-url` on a workspace. `undefined` leaves
   * a field untouched; `''` removes it (back to the default: loopback /
   * `http://localhost:<defaultPort>`). Callers validate `publicUrl` first.
   */
  setNetwork(wsName: string, net: { bindHost?: string; publicUrl?: string }): WorkspaceRecord | null {
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
   * they are and recovered by their directory on re-registration.
   */
  migrateIfNeeded(): ProjectIdRename[] {
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.acquireLock();
    try {
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
      this.writeAtomic(file);
      return renames;
    } finally {
      this.releaseLock();
    }
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
    if (typeof data.$schemaVersion === 'number' && data.$schemaVersion > WORKSPACES_SCHEMA_VERSION) {
      throw new Error(
        `${this.file}: schema version ${data.$schemaVersion} not supported by this claude4spec version`,
      );
    }
    return data;
  }

  /** Re-read under lock → mutate → atomic write. Returns the mutator's value. */
  private withLock<T>(mutate: (data: WorkspacesFile) => T): T {
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.acquireLock();
    try {
      const data = this.readRaw();
      // Writing would persist ids nobody migrated the slots for — the server
      // migrates first (`migrateIfNeeded`), the CLI refuses.
      if (isMigrationPendingFor(data)) throw new RegistryMigrationPendingError(this.file);
      data.$schemaVersion = WORKSPACES_SCHEMA_VERSION;
      const result = mutate(data);
      this.writeAtomic(data);
      return result;
    } finally {
      this.releaseLock();
    }
  }

  private writeAtomic(data: WorkspacesFile): void {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.file);
  }

  private acquireLock(): void {
    const lockPath = this.file + '.lock';
    const deadline = Date.now() + LOCK_STALE_MS * 2;
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue; // lock vanished between open and stat — retry immediately
        }
        if (Date.now() > deadline) {
          throw new Error(`workspaces.json advisory lock held too long: ${lockPath}`);
        }
        sleepSync(25);
      }
    }
  }

  private releaseLock(): void {
    try {
      fs.unlinkSync(this.file + '.lock');
    } catch {
      /* already released / stale-reaped by a peer */
    }
  }
}
