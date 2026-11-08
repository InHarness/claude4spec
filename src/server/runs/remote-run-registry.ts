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
 *
 * 2.1.73: a row also carries the ordering thread (`thread_id` +
 * `thread_project_id`, both set or both NULL) and the plan the Run started
 * with (`project_id` + `plan_path`). ONE INSERT writes every column; a missing
 * value is NULL, never `''`. Nothing reads the new columns in this release, so
 * `get` / `hostOf` leave them out.
 */
export interface RemoteRunRow {
  runId: string;
  hostId: string;
  parentRunId: string | null;
  createdAt: string;
}

/** Everything one INSERT writes; an omitted field is NULL. */
export interface RemoteRunEntry {
  runId: string;
  hostId: string;
  parentRunId?: string | null;
  /** The thread whose turn ordered the Run; NULL in a row restored from a record. */
  threadId?: string | null;
  /** The `id` of that thread's project (`workspace.json`); NULL exactly when `threadId` is. */
  threadProjectId?: string | null;
  /** The Run's `projectId` from its input. */
  projectId?: string | null;
  /** The input's plan path, relative to the plans directory of `projectId`; NULL for a prompt. */
  planPath?: string | null;
}

export interface RemoteRunRegistry {
  insert(entry: RemoteRunEntry): void;
  delete(runId: string): void;
  /** The `hostId` registered for a runId, `null` when none. */
  hostOf(runId: string): string | null;
  /** The whole row of a runId, `null` when none. */
  get(runId: string): RemoteRunRow | null;
}

/** NULL for absent and for `''` — the registry never stores an empty string. */
const orNull = (v: string | null | undefined): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function remoteRunRegistry(db: () => Database.Database): RemoteRunRegistry {
  return {
    insert(entry) {
      let threadId = orNull(entry.threadId);
      let threadProjectId = orNull(entry.threadProjectId);
      // The thread pair: both set or both NULL.
      if (threadId === null || threadProjectId === null) threadId = threadProjectId = null;
      db()
        .prepare(
          `INSERT INTO remote_run (run_id, host_id, parent_run_id, thread_id, thread_project_id, project_id, plan_path)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.runId,
          entry.hostId,
          orNull(entry.parentRunId),
          threadId,
          threadProjectId,
          orNull(entry.projectId),
          orNull(entry.planPath),
        );
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

/**
 * 2.1.73 (`g9939pj0` restoration, `gsw1z1h3`): the Run's project and plan path
 * from the `input` of its OWN record — tolerant, since the runner does not
 * guarantee the input of a record pushed from outside. `c4s-runner` dto
 * `run-record`: kind `plan` → `{ projectId, path }`, kind `prompt` →
 * `{ projectId? }`. An unknown kind gives neither; a missing or wrongly typed
 * field is NULL. Never throws, never substitutes a default project.
 */
export function runInputLocator(input: unknown): { projectId: string | null; planPath: string | null } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { projectId: null, planPath: null };
  const { kind, projectId, path } = input as { kind?: unknown; projectId?: unknown; path?: unknown };
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  if (kind === 'plan') return { projectId: str(projectId), planPath: str(path) };
  if (kind === 'prompt') return { projectId: str(projectId), planPath: null };
  return { projectId: null, planPath: null };
}
