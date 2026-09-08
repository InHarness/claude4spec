import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrate.js';
import { slotDirFor } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';

export interface Db {
  handle: Database.Database;
  close: () => void;
}

/**
 * M41: open handles, keyed by the SLOT PATH — `(workspace, project-id)`.
 *
 * Two registries with two different keys, deliberately: the CONTEXT cache
 * (M31) is keyed by `projectId` alone, because one process serves exactly one
 * workspace; this map is keyed by the slot path, because that is what names a
 * file on disk. The map itself is process-lifetime — it is released when the
 * process exits. What lives inside it is not: a handle belongs to the
 * ProjectContext that asked for it and is closed by that context's dispose.
 * M41 guarantees only that two requests for the same key get the SAME handle;
 * it decides neither when a handle is opened nor when it dies.
 *
 * Refcounted, because "one owner per slot" stopped being true when
 * `invalidate` became fire-and-forget: a retired context whose `dispose()` has
 * not finished and its freshly built successor both hold the same slot key for
 * a window. Without the count the predecessor's dispose would close a handle
 * the successor is already issuing statements on. Last owner out closes it.
 */
interface DbSlot {
  db: Db;
  refs: number;
}
const openSlots = new Map<string, DbSlot>();

/**
 * M31: the derived SQLite lives OUTSIDE the project dir, in the workspace slot
 * `~/.claude4spec/<workspace>/<project-id>/db.sqlite` — the same cwd can carry
 * an independent index per workspace. Keyed on the STABLE stored `projectId`,
 * not a re-hash of cwd, so editing a project's cwd keeps its DB slot.
 *
 * Idempotent per key: a second call for the same slot returns the same handle
 * and takes a reference rather than opening a second connection to one file.
 */
export function openDb(workspace: WorkspaceRecord, projectId: string): Db {
  const dir = slotDirFor(workspace.name, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'db.sqlite');

  const existing = openSlots.get(dbPath);
  if (existing) {
    existing.refs += 1;
    return sharedHandle(dbPath, existing);
  }

  const slot: DbSlot = { db: openDbAt(dbPath), refs: 1 };
  openSlots.set(dbPath, slot);
  return sharedHandle(dbPath, slot);
}

/**
 * One `Db` facade per CALLER, over one shared slot. Each caller gets its own
 * `close()` so a double-close from a single owner cannot drop someone else's
 * reference — the second call on the same facade is a no-op, as `close()` has
 * always been for a context disposed twice.
 */
function sharedHandle(dbPath: string, slot: DbSlot): Db {
  let released = false;
  return {
    handle: slot.db.handle,
    close: () => {
      if (released) return;
      released = true;
      slot.refs -= 1;
      if (slot.refs > 0) return;
      openSlots.delete(dbPath);
      slot.db.close();
    },
  };
}

/**
 * The raw opener: a NEW connection every call, no sharing and no refcount.
 * `openDb` is the keyed entry point; this one takes an arbitrary path and is
 * for callers that genuinely want a private handle (migrations tests, tooling).
 */
export function openDbAt(dbPath: string): Db {
  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');

  const applied = runMigrations(handle);
  if (applied.length) {
    console.log(`  migrations applied: ${applied.join(', ')}`);
  }

  return {
    handle,
    close: () => handle.close(),
  };
}
