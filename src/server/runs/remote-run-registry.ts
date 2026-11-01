import type Database from 'better-sqlite3';

/**
 * M55 `gsw1z1h3` — the write-API of the Runs registry (`remote_run`, workspace
 * DB): INSERT at dispatch and DELETE on a host's `4xx` refusal, never UPDATE
 * (the "Append-only log" exception of L1). The handle comes from
 * `openWorkspaceDb` — the L1 implementor's element (M41 `ay8og61p`).
 */
export interface RemoteRunRegistry {
  insert(runId: string, hostId: string): void;
  delete(runId: string): void;
  /** The `hostId` registered for a runId, `null` when none. */
  hostOf(runId: string): string | null;
}

export function remoteRunRegistry(db: () => Database.Database): RemoteRunRegistry {
  return {
    insert(runId, hostId) {
      db().prepare('INSERT INTO remote_run (run_id, host_id) VALUES (?, ?)').run(runId, hostId);
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
  };
}
