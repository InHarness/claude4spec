import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectIdForCwd } from './project-id.js';
import type { ProjectRecord, WorkspaceRecord, WorkspacesFile } from './types.js';

// v2 (M33): WorkspaceRecord gains optional `plugins[]`. Legacy v1 records lack
// the field and read as predefined-only — no rewrite needed on read. NOTE: any
// mutation by a >=0.1.73 binary rewrites `$schemaVersion` to 2, after which an
// OLDER binary (max schema 1) refuses to open the file (read() forward-compat
// guard). Mixed-version use against one `~/.claude4spec/` is a one-way upgrade.
export const WORKSPACES_SCHEMA_VERSION = 2;
export const DEFAULT_WORKSPACE_PORT = 4500;
const DEFAULT_WORKSPACE_NAME = 'default';
const LOCK_STALE_MS = 5_000;

/**
 * M33: plugin packages built into claude4spec core deps — always present in
 * every workspace regardless of the persisted `plugins[]`. Phase 1 ships none
 * (the 7 entity types are still in-host built-ins registered via
 * `registerAllPlugins`); the mechanism is what matters for forward-compat.
 */
export const PREDEFINED_PLUGINS: readonly string[] = [];

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

  /** Every workspace containing a project for this cwd (0/1/N rule for the CLI). */
  resolveWorkspacesForCwd(cwd: string): WorkspaceRecord[] {
    const id = projectIdForCwd(cwd);
    return this.read().workspaces.filter((w) => w.projects.some((p) => p.id === id));
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
              [...data.workspaces].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened))[0];
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

  /** Idempotent: registers cwd into the workspace, creates the DB slot dir. */
  registerProject(ws: WorkspaceRecord, cwd: string): ProjectRecord {
    const id = projectIdForCwd(cwd);
    const project = this.withLock((data) => {
      const target = data.workspaces.find((w) => w.name === ws.name);
      if (!target) throw new Error(`workspace "${ws.name}" no longer exists in ${this.file}`);
      let p = target.projects.find((x) => x.id === id);
      if (!p) {
        p = { cwd, id, name: path.basename(cwd), addedAt: nowIso() };
        target.projects.push(p);
      }
      return p;
    });
    fs.mkdirSync(this.slotDir(ws, id), { recursive: true });
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

  private read(): WorkspacesFile {
    if (!fs.existsSync(this.file)) {
      return { $schemaVersion: WORKSPACES_SCHEMA_VERSION, workspaces: [] };
    }
    const text = fs.readFileSync(this.file, 'utf8');
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
      const data = this.read();
      data.$schemaVersion = WORKSPACES_SCHEMA_VERSION;
      const result = mutate(data);
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, this.file);
      return result;
    } finally {
      this.releaseLock();
    }
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
