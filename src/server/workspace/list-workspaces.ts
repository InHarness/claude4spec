import { byLastOpenedDesc, WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

/**
 * M31 / L2 — one row of `c4s list-workspaces`.
 *
 * Deliberately NOT a `WorkspaceRecord`: `projects[]` stays collapsed to its
 * length, because the expanded project list is the separate catalog operation
 * `list_projects` and the two are kept disjoint. `plugins[]` is absent for a
 * different reason — it is load configuration, not workspace identity.
 */
export interface WorkspaceSummary {
  name: string;
  mode: WorkspaceRecord['mode'];
  defaultPort: number;
  /** `projects.length` — the count only, never the list. */
  projectCount: number;
  /** ISO-8601 of the last open. Absent on a workspace never opened. */
  lastOpened?: string;
}

/**
 * The registry could not be read at all. Distinct from "there is nothing to
 * read": a missing file is an empty registry, not a failure.
 */
export class WorkspaceRegistryReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceRegistryReadError';
  }
}

/**
 * Server-free read of `~/.claude4spec/workspaces.json` (mode `registry-read`).
 *
 * Takes NO advisory lock. The lock exists for the read-modify-write paths
 * (`setProjectTrust` and friends), where a concurrent writer could lose an
 * update; a whole-file read has nothing to lose to a race, and taking the lock
 * would make the one command you run BEFORE starting a server block on a server
 * that is starting.
 *
 * No file → `[]`. The file is not created, nor is `~/.claude4spec/` — the same
 * laziness `install-skills` applies to its target directory. Anything else that
 * stops the file from being read (invalid JSON, a shape that is not a registry,
 * a schema version from a newer binary, `EACCES`) throws
 * `WorkspaceRegistryReadError` with NO partial result: the file is parsed in one
 * piece, and half the workspaces would be a worse answer than none.
 */
export function listWorkspaces(registry: WorkspaceRegistry = new WorkspaceRegistry()): WorkspaceSummary[] {
  let records: WorkspaceRecord[];
  try {
    records = registry.listWorkspaces();
  } catch (err) {
    // The parse/shape failures already name the file; an `EACCES` from
    // `readFileSync` does too. Anything else gets the path prefixed, so the
    // message always says WHICH registry could not be read.
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkspaceRegistryReadError(
      message.includes(registry.filePath) ? message : `${registry.filePath}: ${message}`,
    );
  }

  const rows = records.map<WorkspaceSummary>((w) => ({
    name: w.name,
    mode: w.mode,
    defaultPort: w.defaultPort,
    projectCount: w.projects.length,
    ...(w.lastOpened !== undefined ? { lastOpened: w.lastOpened } : {}),
  }));

  // Most-recently-opened first, never-opened last in registry order — the same
  // helper the bare-start workspace pick uses, so the two orderings cannot
  // disagree about where a workspace with no timestamp belongs.
  return byLastOpenedDesc(rows);
}
