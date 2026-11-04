import type Database from 'better-sqlite3';

/**
 * M55 `gsw1z1h3` — the write-API of the Runs registry (`remote_run`, workspace
 * DB): INSERT at dispatch (or when a row is restored from the Run record) and
 * DELETE on a host's `4xx` refusal, never UPDATE (the "Append-only log"
 * exception of L1). The handle comes from `openWorkspaceDb` — the L1
 * implementor's element (M41 `ay8og61p`).
 *
 * 2.1.68: a row also carries `parent_run_id` — the parent of a continuation
 * Run (`null` for a Run without one); a row restored from a record takes it
 * from the record's `parentRunId`.
 */
export interface RemoteRunRow {
  runId: string;
  hostId: string;
  parentRunId: string | null;
  createdAt: string;
}

export interface RemoteRunRegistry {
  insert(runId: string, hostId: string, parentRunId?: string | null): void;
  delete(runId: string): void;
  /** The `hostId` registered for a runId, `null` when none. */
  hostOf(runId: string): string | null;
  /** The whole row of a runId, `null` when none. */
  get(runId: string): RemoteRunRow | null;
}

export function remoteRunRegistry(db: () => Database.Database): RemoteRunRegistry {
  return {
    insert(runId, hostId, parentRunId = null) {
      db()
        .prepare('INSERT INTO remote_run (run_id, host_id, parent_run_id) VALUES (?, ?, ?)')
        .run(runId, hostId, parentRunId);
    },
    delete(runId) {
      db().prepare('DELETE FROM remote_run WHERE run_id = ?').run(runId);
    },
    hostOf(runId) {
      const row = db().prepare('SELECT host_id FROM remote_run WHERE run_id = ?').get(runId) as
        | { host_id: string }
        | undefined;
      return row?.host_id ?? null;
    },
    get(runId) {
      const row = db()
        .prepare('SELECT run_id, host_id, parent_run_id, created_at FROM remote_run WHERE run_id = ?')
        .get(runId) as { run_id: string; host_id: string; parent_run_id: string | null; created_at: string } | undefined;
      return row ? { runId: row.run_id, hostId: row.host_id, parentRunId: row.parent_run_id, createdAt: row.created_at } : null;
    },
  };
}
