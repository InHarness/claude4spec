import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { homeLocalDir } from '../workspace/home-workspace.js';
import type { WorkspaceRecord } from '../workspace/types.js';
import { runWorkspaceMigrations } from './workspace-migrations.js';

/**
 * 2.1.64 (M41 `zyj684t8`): the database of WORKSPACE scope — for tables whose
 * data belongs to no project. Only a workspace with a home has one: the file
 * `workspace.sqlite` lives in `<home>/.claude4spec/local/`, next to the slot
 * directories (M31 `t97gncju`, `vzkw903j`). A registry workspace has none, and
 * asking for it is an error, never an empty database.
 *
 * The contract is `openDb`'s, with three differences:
 *  1. the key is the workspace itself — one process serves one workspace;
 *  2. the handle is created on the FIRST REQUEST (not at `ProjectContext`
 *     build) and lives until the process closes (M41 L10 `ay8og61p`: process
 *     lifetime, no key, released explicitly at process close);
 *  3. migrations come from the separate workspace chain (M41 `8eat4b2c`).
 * The pragmas (WAL, `foreign_keys = ON`), idempotence per key and the ban on
 * `new Database(...)` outside this entry point are the same as `openDb`'s.
 */
export const WORKSPACE_DB_FILE = 'workspace.sqlite';

export class WorkspaceDbUnavailableError extends Error {
  readonly code = 'WORKSPACE_DB_UNAVAILABLE';
  readonly workspace: string;

  constructor(workspace: string) {
    super(
      `WORKSPACE_DB_UNAVAILABLE — workspace "${workspace}" is a registry workspace (no home directory) and has no workspace database`,
    );
    this.name = 'WorkspaceDbUnavailableError';
    this.workspace = workspace;
  }
}

/** Path of the workspace database of a workspace with a home. */
export function workspaceDbPath(home: string): string {
  return path.join(homeLocalDir(home), WORKSPACE_DB_FILE);
}

/**
 * Open handles, keyed by the file path. In practice the map holds one entry —
 * the process serves one workspace — but keying by path keeps two workspaces
 * (tests, tooling) from ever sharing a handle onto the wrong file.
 */
const openWorkspaceHandles = new Map<string, Database.Database>();
let exitHookInstalled = false;

/**
 * The single entry point to the workspace database. Synchronous; idempotent per
 * workspace — every call returns the SAME handle. There is no per-caller
 * `close()`: the handle outlives every caller and is closed when the process
 * exits.
 */
export function openWorkspaceDb(workspace: Pick<WorkspaceRecord, 'name' | 'home'>): Database.Database {
  if (workspace.home === undefined) throw new WorkspaceDbUnavailableError(workspace.name);
  const dbPath = path.resolve(workspaceDbPath(workspace.home));

  const existing = openWorkspaceHandles.get(dbPath);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const handle = new Database(dbPath);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    const applied = runWorkspaceMigrations(handle);
    if (applied.length) console.log(`  workspace migrations applied: ${applied.join(', ')}`);
  } catch (err) {
    handle.close();
    throw err;
  }

  openWorkspaceHandles.set(dbPath, handle);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', closeWorkspaceDbs);
  }
  return handle;
}

/**
 * Close every workspace handle — the explicit release at process close (the
 * `exit` hook), also called by tests to start from a clean map.
 */
export function closeWorkspaceDbs(): void {
  for (const handle of openWorkspaceHandles.values()) {
    try {
      handle.close();
    } catch {
      /* already closed */
    }
  }
  openWorkspaceHandles.clear();
}
